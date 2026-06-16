package rules

import (
	"fmt"
	"os"
	"strings"

	"gopkg.in/yaml.v3"

	"justsoc/engine/internal/normalize"
)

type fileConfig struct {
	Rules []fileRule `yaml:"rules"`
}

type fileRule struct {
	ID            string          `yaml:"id"`
	Category      string          `yaml:"category"`
	Stage         string          `yaml:"stage"`
	Reason        string          `yaml:"reason"`
	SuccessSignal bool            `yaml:"success_signal"`
	Match         fileMatchConfig `yaml:"match"`
}

type fileMatchConfig struct {
	Fields []string           `yaml:"fields"`
	Any    []string           `yaml:"any"`
	All    []fileMatchGroup   `yaml:"all"`
}

type fileMatchGroup struct {
	Any []string         `yaml:"any"`
	All []fileMatchGroup `yaml:"all"`
}

func Load(path string) ([]Rule, error) {
	payload, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cfg fileConfig
	if err := yaml.Unmarshal(payload, &cfg); err != nil {
		return nil, fmt.Errorf("parse rules yaml: %w", err)
	}
	if len(cfg.Rules) == 0 {
		return nil, fmt.Errorf("no rules defined")
	}
	rules := make([]Rule, 0, len(cfg.Rules))
	seenIDs := make(map[string]struct{}, len(cfg.Rules))
	for index, raw := range cfg.Rules {
		rule, err := compileRule(raw)
		if err != nil {
			return nil, fmt.Errorf("compile rule %d: %w", index+1, err)
		}
		if _, ok := seenIDs[rule.ID]; ok {
			return nil, fmt.Errorf("duplicate rule id %s", rule.ID)
		}
		seenIDs[rule.ID] = struct{}{}
		rules = append(rules, rule)
	}
	return rules, nil
}

func compileRule(raw fileRule) (Rule, error) {
	id := strings.TrimSpace(raw.ID)
	if id == "" {
		return Rule{}, fmt.Errorf("missing id")
	}
	if strings.TrimSpace(raw.Category) == "" {
		return Rule{}, fmt.Errorf("rule %s missing category", id)
	}
	if strings.TrimSpace(raw.Reason) == "" {
		return Rule{}, fmt.Errorf("rule %s missing reason", id)
	}
	fields := normalizeFieldNames(raw.Match.Fields)
	if len(fields) == 0 {
		return Rule{}, fmt.Errorf("rule %s has no match fields", id)
	}
	root, err := compileMatchGroup(fileMatchGroup{Any: raw.Match.Any, All: raw.Match.All})
	if err != nil {
		return Rule{}, fmt.Errorf("rule %s invalid match: %w", id, err)
	}
	return Rule{
		ID:            id,
		Category:      strings.TrimSpace(raw.Category),
		Stage:         firstNonEmpty(strings.TrimSpace(raw.Stage), "attempt"),
		Reason:        strings.TrimSpace(raw.Reason),
		SuccessSignal: raw.SuccessSignal,
		Match: func(event normalize.ThreatEvent) bool {
			payload := strings.ToLower(strings.Join(selectFields(event, fields), " "))
			return root(payload)
		},
	}, nil
}

func compileMatchGroup(group fileMatchGroup) (func(string) bool, error) {
	anyTerms := normalizeTerms(group.Any)
	children := make([]func(string) bool, 0, len(group.All))
	for _, child := range group.All {
		compiled, err := compileMatchGroup(child)
		if err != nil {
			return nil, err
		}
		children = append(children, compiled)
	}
	if len(anyTerms) == 0 && len(children) == 0 {
		return nil, fmt.Errorf("empty match group")
	}
	return func(payload string) bool {
		anyMatched := false
		if len(anyTerms) > 0 {
			for _, term := range anyTerms {
				if strings.Contains(payload, term) {
					anyMatched = true
					break
				}
			}
		}
		allMatched := len(children) > 0
		for _, child := range children {
			if !child(payload) {
				allMatched = false
				break
			}
		}

		switch {
		case len(anyTerms) > 0 && len(children) > 0:
			return anyMatched || allMatched
		case len(anyTerms) > 0:
			return anyMatched
		default:
			return allMatched
		}
	}, nil
}

func normalizeFieldNames(fields []string) []string {
	result := make([]string, 0, len(fields))
	seen := make(map[string]struct{}, len(fields))
	for _, raw := range fields {
		field := strings.TrimSpace(strings.ToLower(raw))
		if field == "" {
			continue
		}
		if _, ok := seen[field]; ok {
			continue
		}
		seen[field] = struct{}{}
		result = append(result, field)
	}
	return result
}

func normalizeTerms(terms []string) []string {
	result := make([]string, 0, len(terms))
	for _, raw := range terms {
		term := strings.TrimSpace(strings.ToLower(raw))
		if term == "" {
			continue
		}
		result = append(result, term)
	}
	return result
}

func selectFields(event normalize.ThreatEvent, fields []string) []string {
	result := make([]string, 0, len(fields))
	for _, field := range fields {
		switch field {
		case "payload_printable":
			result = append(result, event.PayloadPrintable)
		case "http_url":
			result = append(result, event.HTTPURL)
		case "http_host":
			result = append(result, event.HTTPHost)
		case "event_original":
			result = append(result, event.EventOriginal)
		case "dns_query":
			result = append(result, event.DNSQuery)
		}
	}
	return result
}

func firstNonEmpty(value, fallback string) string {
	if value != "" {
		return value
	}
	return fallback
}
