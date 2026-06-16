package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/fsnotify/fsnotify"
	"justsoc/probe/internal/config"
	"justsoc/probe/internal/enrich"
	"justsoc/probe/internal/eve"
	"justsoc/probe/internal/health"
	"justsoc/probe/internal/initcmd"
	producerpkg "justsoc/probe/internal/kafka"
	"justsoc/probe/internal/pipeline"
	"justsoc/probe/internal/supervisor"
)

func main() {
	var err error
	if len(os.Args) > 1 && os.Args[1] == "init" {
		err = initcmd.Run(os.Args[2:])
	} else {
		err = run()
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "selk-probe: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	configPath := flag.String("config", "configs/probe.example.yaml", "path to probe config")
	verbose := flag.Bool("v", false, "write debug events to stdout instead of Kafka")
	flag.Parse()

	cfg, err := config.LoadEditable(*configPath)
	if err != nil {
		return err
	}

	effectiveOutput := resolveOutput(*verbose)
	if err := cfg.ValidateForOutput(effectiveOutput); err != nil {
		return err
	}

	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.Logging.Level()}))
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	hostname, err := os.Hostname()
	if err != nil {
		return fmt.Errorf("detect hostname: %w", err)
	}

	healthServer := health.NewServer(cfg.Health, logger)
	go healthServer.Start(ctx)

	reader, err := eve.NewReader(cfg.Suricata.EVEPath, cfg.Probe.StartPosition)
	if err != nil {
		return err
	}

	parser := eve.NewParser()
	enricher := enrich.New(cfg.Probe, hostname)

	var sink pipeline.Sink
	switch effectiveOutput {
	case config.OutputDebug:
		sink = pipeline.NewDebugSink()
	case config.OutputKafka:
		producer, err := producerpkg.NewProducer(cfg.Kafka, logger)
		if err != nil {
			return err
		}
		defer producer.Close()
		sink = producer
	default:
		return fmt.Errorf("unsupported probe output: %s", effectiveOutput)
	}

	runner := pipeline.NewRunner(reader, parser, enricher, sink, logger)

	if cfg.Probe.Mode == config.ModeManaged {
		if err := regenerateManagedSuricataArtifacts(cfg, cfg.Suricata.Whitelist); err != nil {
			return err
		}

		suricataSupervisor := supervisor.New(cfg.Suricata, cfg.Probe, logger)
		errCh, err := suricataSupervisor.Start(ctx)
		if err != nil {
			return err
		}

		go func() {
			if supervisorErr, ok := <-errCh; ok && supervisorErr != nil && !errors.Is(supervisorErr, context.Canceled) {
				logger.Error("suricata exited", "error", supervisorErr)
				cancel()
			}
		}()

		if err := startRuleWatcher(ctx, cfg, suricataSupervisor, logger); err != nil {
			return err
		}
		if err := startConfigWatcher(ctx, *configPath, cfg, suricataSupervisor, logger); err != nil {
			return err
		}
	}

	healthServer.SetReady(true)
	if effectiveOutput == config.OutputKafka {
		logger.Info("probe started", "mode", cfg.Probe.Mode, "output", effectiveOutput, "sensor_id", cfg.Probe.SensorID, "topic", cfg.Kafka.Topic)
	} else {
		logger.Info("probe started", "mode", cfg.Probe.Mode, "output", effectiveOutput, "sensor_id", cfg.Probe.SensorID)
	}

	if err := runner.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
		return err
	}

	logger.Info("probe stopped")
	return nil
}

func resolveOutput(verbose bool) string {
	if verbose {
		return config.OutputDebug
	}
	return config.OutputKafka
}

func regenerateManagedSuricataArtifacts(cfg *config.Config, whitelist []config.WhitelistEntry) error {
	managedConfigPath, _, captureFilterPath, ruleDir, err := initcmd.RegenerateManagedSuricataConfig(cfg.Suricata.ConfigPath, cfg.Suricata.Logs, whitelist)
	if err != nil {
		return err
	}
	cfg.Suricata.ConfigPath = managedConfigPath
	cfg.Suricata.ManagedCaptureFilterPath = captureFilterPath
	cfg.Suricata.RuleDir = ruleDir
	cfg.Suricata.Whitelist = append([]config.WhitelistEntry(nil), whitelist...)
	return nil
}

func shouldReloadRuleFile(path string) bool {
	return strings.EqualFold(filepath.Ext(path), ".rules")
}

func samePath(left, right string) bool {
	return strings.EqualFold(filepath.Clean(left), filepath.Clean(right))
}

func whitelistEqual(left, right []config.WhitelistEntry) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

func startConfigWatcher(ctx context.Context, configPath string, cfg *config.Config, suricataSupervisor *supervisor.Supervisor, logger *slog.Logger) error {
	absConfigPath, err := filepath.Abs(configPath)
	if err != nil {
		return fmt.Errorf("resolve config path %s: %w", configPath, err)
	}
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return fmt.Errorf("create config watcher: %w", err)
	}
	configDir := filepath.Dir(absConfigPath)
	if err := watcher.Add(configDir); err != nil {
		_ = watcher.Close()
		return fmt.Errorf("watch config directory %s: %w", configDir, err)
	}

	go func() {
		defer watcher.Close()
		var timer *time.Timer
		var timerCh <-chan time.Time
		for {
			select {
			case <-ctx.Done():
				if timer != nil {
					timer.Stop()
				}
				return
			case event, ok := <-watcher.Events:
				if !ok {
					return
				}
				if !samePath(event.Name, absConfigPath) {
					continue
				}
				if event.Op&(fsnotify.Write|fsnotify.Create|fsnotify.Rename) == 0 {
					continue
				}
				logger.Info("probe config change detected", "file", event.Name, "op", event.Op.String())
				if timer != nil {
					timer.Stop()
				}
				timer = time.NewTimer(time.Second)
				timerCh = timer.C
			case <-timerCh:
				timerCh = nil
				nextCfg, err := config.LoadEditable(absConfigPath)
				if err != nil {
					logger.Error("reload probe config", "error", err)
					continue
				}
				if err := nextCfg.ValidateWhitelist(); err != nil {
					logger.Error("validate probe whitelist", "error", err)
					continue
				}
				if whitelistEqual(cfg.Suricata.Whitelist, nextCfg.Suricata.Whitelist) {
					logger.Info("probe config changed but whitelist unchanged; restart probe for non-whitelist changes")
					continue
				}
				if err := regenerateManagedSuricataArtifacts(cfg, nextCfg.Suricata.Whitelist); err != nil {
					logger.Error("regenerate managed suricata config", "error", err)
					continue
				}
				if err := suricataSupervisor.Restart(); err != nil {
					logger.Error("reload suricata whitelist", "error", err)
					continue
				}
				cfg.Suricata.Whitelist = append([]config.WhitelistEntry(nil), nextCfg.Suricata.Whitelist...)
				logger.Info("suricata whitelist reloaded", "rules", len(cfg.Suricata.Whitelist))
			case err, ok := <-watcher.Errors:
				if !ok {
					return
				}
				logger.Error("probe config watcher error", "error", err)
			}
		}
	}()
	return nil
}

func startRuleWatcher(ctx context.Context, cfg *config.Config, suricataSupervisor *supervisor.Supervisor, logger *slog.Logger) error {
	var ruleDir string
	if strings.TrimSpace(cfg.Suricata.RuleDir) != "" {
		ruleDir = cfg.Suricata.RuleDir
	} else {
		var err error
		ruleDir, err = initcmd.ManagedRuleDirectory()
		if err != nil {
			return err
		}
	}
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return fmt.Errorf("create rule watcher: %w", err)
	}
	if err := watcher.Add(ruleDir); err != nil {
		_ = watcher.Close()
		return fmt.Errorf("watch rule directory %s: %w", ruleDir, err)
	}

	go func() {
		defer watcher.Close()
		var timer *time.Timer
		var timerCh <-chan time.Time
		for {
			select {
			case <-ctx.Done():
				if timer != nil {
					timer.Stop()
				}
				return
			case event, ok := <-watcher.Events:
				if !ok {
					return
				}
				if !shouldReloadRuleFile(event.Name) {
					continue
				}
				if event.Op&(fsnotify.Write|fsnotify.Create|fsnotify.Remove|fsnotify.Rename) == 0 {
					continue
				}
				logger.Info("suricata rule change detected", "file", event.Name, "op", event.Op.String())
				if timer != nil {
					timer.Stop()
				}
				timer = time.NewTimer(time.Second)
				timerCh = timer.C
			case <-timerCh:
				timerCh = nil
				if err := regenerateManagedSuricataArtifacts(cfg, cfg.Suricata.Whitelist); err != nil {
					logger.Error("regenerate managed suricata config", "error", err)
					continue
				}
				if err := suricataSupervisor.Restart(); err != nil {
					logger.Error("reload suricata rules", "error", err)
					continue
				}
				logger.Info("suricata rules reloaded")
			case err, ok := <-watcher.Errors:
				if !ok {
					return
				}
				logger.Error("suricata rule watcher error", "error", err)
			}
		}
	}()
	return nil
}
