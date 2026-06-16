package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"time"

	"justsoc/engine/internal/correlate"
	"justsoc/engine/internal/evaluate"
	"justsoc/engine/internal/normalize"
	"justsoc/engine/internal/rules"
	"justsoc/engine/internal/runtimeconfig"
	"justsoc/engine/internal/whitelist"
)

type sample struct {
	path  string
	event normalize.ThreatEvent
}

func main() {
	configPath := flag.String("config", "configs/engine.conf", "path to engine config file")
	flag.Parse()

	logger := log.New(os.Stdout, "replay-samples ", log.LstdFlags|log.Lmsgprefix)
	paths := flag.Args()
	if len(paths) == 0 {
		paths = []string{"testdata"}
	}

	cfg, resolvedConfigPath, err := runtimeconfig.Load(*configPath)
	if err != nil {
		logger.Fatalf("load config: %v", err)
	}
	evaluate.SetSuricataRulesDir(cfg.Rules.SuricataDir)

	ruleSet := rules.Default()
	if cfg.Rules.Path != "" {
		ruleSet, err = rules.Load(cfg.Rules.Path)
		if err != nil {
			logger.Fatalf("load rules: %v", err)
		}
	}
	store := correlate.NewStore(10 * time.Minute)
	evaluator := evaluate.New(ruleSet, store)
	matcher := whitelist.Disabled()
	whitelistPath := cfg.Whitelist.Path
	if whitelistPath != "" {
		matcher, err = whitelist.Load(whitelistPath)
		if err != nil {
			logger.Fatalf("load whitelist: %v", err)
		}
	}
	if matcher.Enabled() {
		logger.Printf("config=%s rules_file=%s suricata_dir=%s whitelist enabled path=%s rules=%d", resolvedConfigPath, cfg.Rules.Path, cfg.Rules.SuricataDir, whitelistPath, matcher.RuleCount())
	} else {
		logger.Printf("config=%s rules_file=%s suricata_dir=%s whitelist=disabled", resolvedConfigPath, cfg.Rules.Path, cfg.Rules.SuricataDir)
	}
	samples := make([]sample, 0)

	for _, root := range paths {
		if err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}
			if info.IsDir() || filepath.Ext(path) != ".json" {
				return nil
			}
			payload, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			var raw map[string]any
			if err := json.Unmarshal(payload, &raw); err != nil {
				return fmt.Errorf("parse %s: %w", path, err)
			}
			event, err := normalize.FromRaw(raw)
			if err != nil {
				return fmt.Errorf("normalize %s: %w", path, err)
			}
			samples = append(samples, sample{path: path, event: event})
			return nil
		}); err != nil {
			logger.Fatalf("replay samples: %v", err)
		}
	}

	sort.Slice(samples, func(i, j int) bool {
		left := samples[i].event.Timestamp
		right := samples[j].event.Timestamp
		if left.IsZero() && right.IsZero() {
			return samples[i].path < samples[j].path
		}
		if left.IsZero() {
			return false
		}
		if right.IsZero() {
			return true
		}
		return left.Before(right)
	})

	for _, sample := range samples {
		if matched, ruleName := matcher.Match(sample.event); matched {
			logger.Printf("skip sample=%s whitelist_rule=%s", sample.path, ruleName)
			continue
		}
		enriched := evaluator.Evaluate(sample.event)
		encoded, _ := json.MarshalIndent(enriched, "", "  ")
		fmt.Printf("===== %s =====\n%s\n", sample.path, string(encoded))
	}
}
