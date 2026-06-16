package evaluate

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"justsoc/engine/internal/correlate"
	"justsoc/engine/internal/normalize"
)

func TestMain(m *testing.M) {
	_, currentFile, _, ok := runtime.Caller(0)
	if ok {
		rulesDir := filepath.Join(filepath.Dir(currentFile), "..", "..", "..", "probe", "suricata-rules")
		SetSuricataRulesDir(rulesDir)
	}
	os.Exit(m.Run())
}

func TestEvaluatorDetectsDirectoryScan(t *testing.T) {
	evaluator := New(nil, correlate.NewStore(time.Minute))
	startedAt := time.Date(2026, 5, 12, 12, 0, 0, 0, time.UTC)

	var enriched map[string]any
	for i := 0; i < 12; i++ {
		enriched = evaluator.Evaluate(normalize.ThreatEvent{
			Timestamp:  startedAt.Add(time.Duration(i) * time.Second),
			EventType:  "http",
			SrcIP:      "10.0.0.10",
			DestIP:     "10.0.0.20",
			DestPort:   80,
			HTTPHost:   "demo.internal",
			HTTPMethod: "GET",
			HTTPURL:    fmt.Sprintf("/admin/%d?from=scan", i),
			HTTPStatus: 404,
			Raw:        map[string]any{"event_type": "http"},
			Enrichment: map[string]any{},
		})
	}

	if enriched["event_type"] != "alert" {
		t.Fatalf("event_type = %v, want alert", enriched["event_type"])
	}

	alert := nestedMap(t, enriched, "alert")
	if alert["signature_id"] != engineGeneratedDirectoryScanSID {
		t.Fatalf("signature_id = %v, want %d", alert["signature_id"], engineGeneratedDirectoryScanSID)
	}
	if alert["category"] != "Web Application Attack" {
		t.Fatalf("category = %v, want Web Application Attack", alert["category"])
	}
	if alert["severity"] != 2 {
		t.Fatalf("severity = %v, want 2", alert["severity"])
	}
	if alert["action"] != "allowed" {
		t.Fatalf("action = %v, want allowed", alert["action"])
	}
	if signature, _ := alert["signature"].(string); signature == "" {
		t.Fatalf("signature missing: %#v", alert["signature"])
	}
	alertMetadata := nestedMap(t, alert, "metadata")
	assertStringSliceContains(t, alertMetadata["selk_category"], "目录扫描")

	rule := nestedMap(t, enriched, "rule")
	if rule["id"] != fmt.Sprintf("%d", engineGeneratedDirectoryScanSID) {
		t.Fatalf("rule.id = %v, want %d", rule["id"], engineGeneratedDirectoryScanSID)
	}
	if rule["name"] != alert["signature"] {
		t.Fatalf("rule.name = %v, want %v", rule["name"], alert["signature"])
	}

	eventFields := nestedMap(t, enriched, "event")
	if eventFields["severity"] != "高危" {
		t.Fatalf("event.severity = %v, want 高危", eventFields["severity"])
	}

	engine := engineMap(t, enriched)
	if engine["behavior"] != "directory_scan" {
		t.Fatalf("behavior = %v, want directory_scan", engine["behavior"])
	}
	if engine["attack_success"] != false {
		t.Fatalf("attack_success = %v, want false", engine["attack_success"])
	}

	directoryScan := nestedMap(t, engine, "directory_scan")
	if directoryScan["distinct_paths"] != 12 {
		t.Fatalf("distinct_paths = %v, want 12", directoryScan["distinct_paths"])
	}
	if directoryScan["total_requests"] != 12 {
		t.Fatalf("total_requests = %v, want 12", directoryScan["total_requests"])
	}
	if directoryScan["error_requests"] != 12 {
		t.Fatalf("error_requests = %v, want 12", directoryScan["error_requests"])
	}
	if directoryScan["target"] != "demo.internal" {
		t.Fatalf("target = %v, want demo.internal", directoryScan["target"])
	}
}

func TestEvaluatorDoesNotOverrideExistingAlertWhenDirectoryScanMatches(t *testing.T) {
	evaluator := New(nil, correlate.NewStore(time.Minute))
	startedAt := time.Date(2026, 5, 12, 12, 0, 0, 0, time.UTC)

	var enriched map[string]any
	for i := 0; i < 12; i++ {
		raw := map[string]any{"event_type": "http"}
		if i == 11 {
			raw["event_type"] = "alert"
			raw["alert"] = map[string]any{
				"signature":    "existing alert",
				"signature_id": 1002001,
				"category":     "existing category",
				"severity":     1,
			}
			raw["rule"] = map[string]any{
				"id":   "1002001",
				"name": "existing alert",
			}
		}
		enriched = evaluator.Evaluate(normalize.ThreatEvent{
			Timestamp:        startedAt.Add(time.Duration(i) * time.Second),
			EventType:        anyToString(raw["event_type"]),
			SrcIP:            "10.0.0.10",
			DestIP:           "10.0.0.20",
			DestPort:         80,
			HTTPHost:         "demo.internal",
			HTTPMethod:       "GET",
			HTTPURL:          fmt.Sprintf("/admin/%d?from=scan", i),
			HTTPStatus:       404,
			AlertSignature:   "existing alert",
			AlertSignatureID: 1002001,
			Severity:         1,
			Raw:              raw,
			Enrichment:       map[string]any{},
		})
	}

	alert := nestedMap(t, enriched, "alert")
	if alert["signature"] != "existing alert" {
		t.Fatalf("signature = %v, want existing alert", alert["signature"])
	}
	if alert["signature_id"] != 1002001 {
		t.Fatalf("signature_id = %v, want 1002001", alert["signature_id"])
	}
	if enriched["event_type"] != "alert" {
		t.Fatalf("event_type = %v, want alert", enriched["event_type"])
	}
	engine := engineMap(t, enriched)
	if engine["behavior"] != "directory_scan" {
		t.Fatalf("behavior = %v, want directory_scan", engine["behavior"])
	}
}

func TestEvaluatorDoesNotCountQueryVariantsAsDistinctPaths(t *testing.T) {
	evaluator := New(nil, correlate.NewStore(time.Minute))
	startedAt := time.Date(2026, 5, 12, 12, 0, 0, 0, time.UTC)

	var enriched map[string]any
	for i := 0; i < 20; i++ {
		enriched = evaluator.Evaluate(normalize.ThreatEvent{
			Timestamp:  startedAt.Add(time.Duration(i) * time.Second),
			EventType:  "http",
			SrcIP:      "10.0.0.10",
			DestIP:     "10.0.0.20",
			DestPort:   80,
			HTTPHost:   "demo.internal",
			HTTPMethod: "GET",
			HTTPURL:    fmt.Sprintf("/admin/login?attempt=%d", i),
			HTTPStatus: 404,
			Raw:        map[string]any{"event_type": "http"},
			Enrichment: map[string]any{},
		})
	}

	engine := engineMap(t, enriched)
	if _, ok := engine["behavior"]; ok {
		t.Fatalf("unexpected directory scan behavior: %+v", engine)
	}
}

func TestEvaluatorDoesNotMixDifferentHosts(t *testing.T) {
	evaluator := New(nil, correlate.NewStore(time.Minute))
	startedAt := time.Date(2026, 5, 12, 12, 0, 0, 0, time.UTC)

	var enriched map[string]any
	for i := 0; i < 12; i++ {
		host := "one.internal"
		if i%2 == 1 {
			host = "two.internal"
		}
		enriched = evaluator.Evaluate(normalize.ThreatEvent{
			Timestamp:  startedAt.Add(time.Duration(i) * time.Second),
			EventType:  "http",
			SrcIP:      "10.0.0.10",
			DestIP:     "10.0.0.20",
			DestPort:   80,
			HTTPHost:   host,
			HTTPMethod: "GET",
			HTTPURL:    fmt.Sprintf("/dir/%d", i),
			HTTPStatus: 404,
			Raw:        map[string]any{"event_type": "http"},
			Enrichment: map[string]any{},
		})
	}

	engine := engineMap(t, enriched)
	if _, ok := engine["behavior"]; ok {
		t.Fatalf("unexpected directory scan behavior: %+v", engine)
	}
}

func TestEvaluatorRequiresHighErrorRatioForDirectoryScan(t *testing.T) {
	evaluator := New(nil, correlate.NewStore(time.Minute))
	startedAt := time.Date(2026, 5, 12, 12, 0, 0, 0, time.UTC)

	var enriched map[string]any
	for i := 0; i < 12; i++ {
		status := 200
		if i < 6 {
			status = 404
		}
		enriched = evaluator.Evaluate(normalize.ThreatEvent{
			Timestamp:  startedAt.Add(time.Duration(i) * time.Second),
			EventType:  "http",
			SrcIP:      "10.0.0.10",
			DestIP:     "10.0.0.20",
			DestPort:   80,
			HTTPHost:   "demo.internal",
			HTTPMethod: "GET",
			HTTPURL:    fmt.Sprintf("/path/%d", i),
			HTTPStatus: status,
			Raw:        map[string]any{"event_type": "http"},
			Enrichment: map[string]any{},
		})
	}

	engine := engineMap(t, enriched)
	if _, ok := engine["behavior"]; ok {
		t.Fatalf("unexpected directory scan behavior: %+v", engine)
	}
}

func engineMap(t *testing.T, enriched map[string]any) map[string]any {
	t.Helper()
	engine, ok := enriched["engine"].(map[string]any)
	if !ok {
		t.Fatalf("engine enrichment missing or wrong type: %#v", enriched["engine"])
	}
	return engine
}

func nestedMap(t *testing.T, values map[string]any, key string) map[string]any {
	t.Helper()
	child, ok := values[key].(map[string]any)
	if !ok {
		t.Fatalf("%s missing or wrong type: %#v", key, values[key])
	}
	return child
}

func assertStringSliceContains(t *testing.T, value any, expected string) {
	t.Helper()
	items, ok := value.([]string)
	if ok {
		for _, item := range items {
			if item == expected {
				return
			}
		}
		t.Fatalf("value %v does not contain %q", items, expected)
	}

	genericItems, ok := value.([]any)
	if !ok {
		t.Fatalf("value has unexpected type: %#v", value)
	}
	for _, item := range genericItems {
		if text, ok := item.(string); ok && text == expected {
			return
		}
	}
	t.Fatalf("value %v does not contain %q", genericItems, expected)
}

func anyToString(value any) string {
	text, _ := value.(string)
	return text
}
