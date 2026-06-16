package whitelist

import (
	"testing"

	"justsoc/engine/internal/normalize"
)

func TestMatcherMatchByCIDRPortAndPrefix(t *testing.T) {
	matcher, err := Load("testdata/whitelist.json")
	if err != nil {
		t.Fatalf("load whitelist: %v", err)
	}

	event := normalize.ThreatEvent{
		SrcIP:    "192.168.52.88",
		DestIP:   "192.168.52.148",
		DestPort: 80,
		HTTPURL:  "/healthz?full=1",
	}
	matched, ruleName := matcher.Match(event)
	if !matched {
		t.Fatalf("expected whitelist match")
	}
	if ruleName != "ignore-health-check" {
		t.Fatalf("unexpected rule name %q", ruleName)
	}
}

func TestMatcherRequiresAllConfiguredFields(t *testing.T) {
	matcher, err := Load("testdata/whitelist.json")
	if err != nil {
		t.Fatalf("load whitelist: %v", err)
	}

	event := normalize.ThreatEvent{
		SrcIP:    "192.168.52.88",
		DestIP:   "192.168.52.148",
		DestPort: 443,
		HTTPURL:  "/healthz?full=1",
	}
	matched, _ := matcher.Match(event)
	if matched {
		t.Fatalf("expected no match when dest_port differs")
	}
}

func TestMatcherExactURLAndDestIP(t *testing.T) {
	matcher, err := Load("testdata/whitelist.json")
	if err != nil {
		t.Fatalf("load whitelist: %v", err)
	}

	event := normalize.ThreatEvent{
		DestIP:  "10.10.10.10",
		HTTPURL: "/internal/ping",
	}
	matched, ruleName := matcher.Match(event)
	if !matched || ruleName != "ignore-internal-ping" {
		t.Fatalf("expected internal ping rule match, got matched=%v rule=%q", matched, ruleName)
	}
}

func TestLoadRejectsEmptyRule(t *testing.T) {
	_, err := Load("testdata/invalid-whitelist.json")
	if err == nil {
		t.Fatalf("expected invalid config error")
	}
}
