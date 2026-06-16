package evaluate

import (
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
	"time"

	"justsoc/engine/internal/correlate"
	"justsoc/engine/internal/normalize"
	"justsoc/engine/internal/rules"
)

func TestEvaluatorDoesNotTreatFramework200AsSuccess(t *testing.T) {
	evaluator := newTestEvaluatorWithLoadedRules(t)
	event := normalize.ThreatEvent{
		Timestamp:                 time.Date(2026, 5, 13, 13, 48, 17, 0, time.UTC),
		EventType:                 "alert",
		SrcIP:                     "27.18.168.234",
		DestIP:                    "172.20.119.79",
		DestPort:                  8088,
		AlertSignature:            "Spring Actuator high-risk endpoint probe",
		AlertSignatureID:          1002143,
		HTTPMethod:                "GET",
		HTTPURL:                   "/actuator/env",
		HTTPHost:                  "203.0.113.10",
		HTTPStatus:                200,
		PayloadPrintable:          "GET /actuator/env HTTP/1.1\r\nHost: 203.0.113.10:8088\r\n\r\n",
		HTTPResponseBodyPrintable: "<!DOCTYPE html><html><head><title>Hotline Platform</title></head><body><div id=\"app\"></div></body></html>",
		Raw:                       map[string]any{"event_type": "alert"},
		Enrichment:                map[string]any{},
	}

	enriched := evaluator.Evaluate(event)
	engine := engineMap(t, enriched)

	if engine["attack_stage"] != "attempt" {
		t.Fatalf("attack_stage = %v, want attempt", engine["attack_stage"])
	}
	if engine["attack_success"] != false {
		t.Fatalf("attack_success = %v, want false", engine["attack_success"])
	}
	if reasons := stringSliceValue(t, engine["attack_success_reason"]); len(reasons) != 0 {
		t.Fatalf("attack_success_reason = %v, want empty", reasons)
	}
}

func TestEvaluatorDoesNotTreatUploadAttemptAsSuccessFromCrossRuleMatch(t *testing.T) {
	evaluator := newTestEvaluatorWithLoadedRules(t)
	event := normalize.ThreatEvent{
		Timestamp:                 time.Date(2026, 5, 13, 13, 48, 6, 0, time.UTC),
		EventType:                 "alert",
		SrcIP:                     "27.18.168.234",
		DestIP:                    "172.20.119.79",
		DestPort:                  8088,
		AlertSignature:            "Dangerous executable upload attempt",
		AlertSignatureID:          1004001,
		HTTPMethod:                "POST",
		HTTPURL:                   "/src/php/upload.php",
		HTTPHost:                  "203.0.113.10",
		HTTPStatus:                405,
		PayloadPrintable:          "POST /src/php/upload.php HTTP/1.1\r\nContent-Type: multipart/form-data\r\n\r\nfilename=\"uibd.php\"\r\n<?php echo 4555317;?>",
		HTTPResponseBodyPrintable: "<!doctype html><html><title>405 Method Not Allowed</title><body>Method Not Allowed</body></html>",
		Raw:                       map[string]any{"event_type": "alert"},
		Enrichment:                map[string]any{},
	}

	enriched := evaluator.Evaluate(event)
	engine := engineMap(t, enriched)

	if engine["attack_stage"] != "attempt" {
		t.Fatalf("attack_stage = %v, want attempt", engine["attack_stage"])
	}
	if engine["attack_success"] != false {
		t.Fatalf("attack_success = %v, want false", engine["attack_success"])
	}
	if matches := stringSliceValue(t, engine["engine_matches"]); !reflect.DeepEqual(matches, []string{"engine.upload.webshell.001"}) {
		t.Fatalf("engine_matches = %v, want only upload rule", matches)
	}
}

func TestEvaluatorDoesNotTreatBlindSQLi200AsSuccess(t *testing.T) {
	evaluator := newTestEvaluatorWithLoadedRules(t)
	event := normalize.ThreatEvent{
		Timestamp:                 time.Date(2026, 5, 13, 13, 48, 14, 0, time.UTC),
		EventType:                 "alert",
		SrcIP:                     "27.18.168.234",
		DestIP:                    "172.20.119.79",
		DestPort:                  8088,
		AlertSignature:            "SQL error-based injection function URI parameter attempt",
		AlertSignatureID:          1000004,
		HTTPMethod:                "GET",
		HTTPURL:                   "/login/Login/editPass.html?comid=extractvalue(1,concat(char(126),md5(765)))",
		HTTPHost:                  "203.0.113.10",
		HTTPStatus:                200,
		PayloadPrintable:          "GET /login/Login/editPass.html?comid=extractvalue(1,concat(char(126),md5(765))) HTTP/1.1\r\nHost: 203.0.113.10:8088\r\n\r\n",
		HTTPResponseBodyPrintable: "<!DOCTYPE html><html><head><title>Hotline Platform</title></head><body>home page</body></html>",
		Raw:                       map[string]any{"event_type": "alert"},
		Enrichment:                map[string]any{},
	}

	enriched := evaluator.Evaluate(event)
	engine := engineMap(t, enriched)

	if engine["attack_stage"] != "attempt" {
		t.Fatalf("attack_stage = %v, want attempt", engine["attack_stage"])
	}
	if engine["attack_success"] != false {
		t.Fatalf("attack_success = %v, want false", engine["attack_success"])
	}
}

func newTestEvaluatorWithLoadedRules(t *testing.T) *Evaluator {
	t.Helper()

	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatalf("resolve current file")
	}
	path := filepath.Join(filepath.Dir(currentFile), "..", "..", "configs", "engine-rules.yaml")
	loadedRules, err := rules.Load(path)
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	return New(loadedRules, correlate.NewStore(10*time.Minute))
}

func stringSliceValue(t *testing.T, value any) []string {
	t.Helper()
	items, ok := value.([]string)
	if ok {
		return items
	}

	genericItems, ok := value.([]any)
	if !ok {
		t.Fatalf("value has unexpected type: %#v", value)
	}
	result := make([]string, 0, len(genericItems))
	for _, item := range genericItems {
		text, ok := item.(string)
		if !ok {
			t.Fatalf("value contains non-string item: %#v", item)
		}
		result = append(result, text)
	}
	return result
}
