package evaluate

import (
	"testing"

	"justsoc/engine/internal/normalize"
)

func TestLoadSuricataHighlightProfiles(t *testing.T) {
	profiles, err := loadSuricataHighlightProfiles()
	if err != nil {
		t.Fatalf("loadSuricataHighlightProfiles() error = %v", err)
	}
	if _, ok := profiles[1000004]; !ok {
		t.Fatalf("expected SQLi SID 1000004 to exist")
	}
	if _, ok := profiles[1006001]; !ok {
		t.Fatalf("expected Log4j SID 1006001 to exist")
	}
}

func TestBuildHighlightsFromSIDProfile(t *testing.T) {
	terms, fragments := buildHighlights(sampleEvent(), []string{"suricata_sqli_attempt_detected"})
	if len(terms) == 0 {
		t.Fatalf("expected highlight terms")
	}
	if len(fragments) == 0 {
		t.Fatalf("expected highlight fragments")
	}
}

func sampleEvent() normalize.ThreatEvent {
	return normalize.ThreatEvent{
		AlertSignatureID: 1000002,
		PayloadPrintable: "GET /?id=1%20AND%20SLEEP(5) HTTP/1.1",
		HTTPURL:          "/?id=1%20AND%20SLEEP(5)",
	}
}
