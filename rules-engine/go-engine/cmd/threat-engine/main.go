package main

import (
	"context"
	"encoding/json"
	"flag"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"justsoc/engine/internal/assets"
	"justsoc/engine/internal/consumer"
	"justsoc/engine/internal/correlate"
	"justsoc/engine/internal/evaluate"
	"justsoc/engine/internal/normalize"
	"justsoc/engine/internal/rules"
	"justsoc/engine/internal/runtimeconfig"
	"justsoc/engine/internal/sink"
	"justsoc/engine/internal/whitelist"
)

func main() {
	configPath := flag.String("config", "configs/engine.conf", "path to engine config file")
	flag.Parse()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	logger := log.New(os.Stdout, "threat-engine ", log.LstdFlags|log.Lmsgprefix)
	cfg, resolvedConfigPath, err := runtimeconfig.Load(*configPath)
	if err != nil {
		logger.Fatalf("load config: %v", err)
	}
	evaluate.SetSuricataRulesDir(cfg.Rules.SuricataDir)
	debugEnabled := cfg.Debug
	matcher := whitelist.Disabled()
	whitelistPath := cfg.Whitelist.Path
	if strings.TrimSpace(whitelistPath) != "" {
		matcher, err = whitelist.Load(whitelistPath)
		if err != nil {
			logger.Fatalf("load whitelist: %v", err)
		}
	}
	assetManager := assets.NewManager(cfg.Assets.Path)
	if assetManager.Enabled() {
		changed, err := assetManager.ReloadIfChanged()
		switch {
		case err != nil:
			logger.Printf("load assets path=%s failed: %v", assetManager.Path(), err)
		case changed:
			m := assetManager.Matcher()
			logger.Printf("assets loaded path=%s version=%s bindings=%d", assetManager.Path(), m.Version(), m.BindingCount())
		default:
			logger.Printf("assets configured path=%s but no file is available yet", assetManager.Path())
		}
	}
	processedTotal := 0
	skippedTotal := 0
	skipBreakdown := make(map[string]int)
	defer func() {
		logger.Printf("summary processed=%d skipped=%d", processedTotal, skippedTotal)
		for ruleName, count := range skipBreakdown {
			logger.Printf("summary whitelist rule=%s skipped=%d", ruleName, count)
		}
	}()

	ruleSet := rules.Default()
	if strings.TrimSpace(cfg.Rules.Path) != "" {
		ruleSet, err = rules.Load(cfg.Rules.Path)
		if err != nil {
			logger.Fatalf("load rules: %v", err)
		}
	}
	store := correlate.NewStore(10 * time.Minute)
	evaluator := evaluate.New(ruleSet, store)
	writer, outputMode, err := sink.NewWriter(logger, cfg)
	if err != nil {
		logger.Fatalf("init writer: %v", err)
	}
	defer writer.Close()

	reader := consumer.NewKafkaReader(logger, cfg.Kafka, cfg.Consumer.Topic, cfg.Consumer.GroupID)
	defer reader.Close()

	if matcher.Enabled() {
		logger.Printf("starting config=%s with %d rules, output=%s, rules_file=%s, suricata_dir=%s, whitelist=%s, whitelist_rules=%d", resolvedConfigPath, len(ruleSet), outputMode, cfg.Rules.Path, cfg.Rules.SuricataDir, whitelistPath, matcher.RuleCount())
	} else {
		logger.Printf("starting config=%s with %d rules, output=%s, rules_file=%s, suricata_dir=%s, whitelist=disabled", resolvedConfigPath, len(ruleSet), outputMode, cfg.Rules.Path, cfg.Rules.SuricataDir)
	}
	for {
		event, err := reader.Read(ctx)
		if err != nil {
			if ctx.Err() != nil {
				logger.Printf("shutting down")
				return
			}
			logger.Printf("read event: %v", err)
			continue
		}

		threatEvent, err := normalize.FromRaw(event)
		if err != nil {
			logger.Printf("normalize event: %v", err)
			continue
		}
		processedTotal++
		if matched, ruleName := matcher.Match(threatEvent); matched {
			skippedTotal++
			skipBreakdown[ruleName]++
			if debugEnabled {
				logger.Printf("whitelist skip rule=%s src_ip=%s dest_ip=%s src_port=%d dest_port=%d http_url=%s", ruleName, threatEvent.SrcIP, threatEvent.DestIP, threatEvent.SrcPort, threatEvent.DestPort, threatEvent.HTTPURL)
			}
			continue
		}

		enriched := evaluator.Evaluate(threatEvent)
		if assetManager.Enabled() {
			if changed, err := assetManager.ReloadIfChanged(); err != nil {
				logger.Printf("reload assets path=%s failed: %v", assetManager.Path(), err)
			} else if changed {
				m := assetManager.Matcher()
				logger.Printf("assets reloaded path=%s version=%s bindings=%d", assetManager.Path(), m.Version(), m.BindingCount())
			}
			assets.EnrichDocument(enriched, assetManager.Matcher(), threatEvent.SrcIP, threatEvent.DestIP)
		}
		if debugEnabled {
			if payload, err := json.Marshal(enriched); err != nil {
				logger.Printf("debug marshal event: %v", err)
			} else {
				logger.Printf("debug event: %s", payload)
			}
		}
		if err := writer.Write(ctx, enriched); err != nil {
			logger.Printf("write event: %v", err)
		}
	}
}

func envEnabled(key string) bool {
	value := strings.TrimSpace(strings.ToLower(os.Getenv(key)))
	return value == "1" || value == "true" || value == "yes" || value == "on"
}
