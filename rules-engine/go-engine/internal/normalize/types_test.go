package normalize

import "testing"

func TestFromRawPrefersCorrelatedHTTPEndpoints(t *testing.T) {
	raw := map[string]any{
		"event_type": "alert",
		"src_ip":     "192.168.52.148",
		"src_port":   float64(9200),
		"dest_ip":    "192.168.52.1",
		"dest_port":  float64(62311),
		"correlated_http": map[string]any{
			"src_ip":    "192.168.52.1",
			"src_port":  float64(62311),
			"dest_ip":   "192.168.52.148",
			"dest_port": float64(9200),
			"http": map[string]any{
				"url": "/justsoc-*/_search?ignore_unavailable=true",
			},
		},
	}

	event, err := FromRaw(raw)
	if err != nil {
		t.Fatalf("FromRaw returned error: %v", err)
	}
	if event.SrcIP != "192.168.52.1" || event.SrcPort != 62311 {
		t.Fatalf("unexpected source endpoint: %s:%d", event.SrcIP, event.SrcPort)
	}
	if event.DestIP != "192.168.52.148" || event.DestPort != 9200 {
		t.Fatalf("unexpected destination endpoint: %s:%d", event.DestIP, event.DestPort)
	}
}

func TestFromRawFallsBackToFlowEndpoints(t *testing.T) {
	raw := map[string]any{
		"event_type": "alert",
		"src_ip":     "192.168.52.148",
		"src_port":   float64(9200),
		"dest_ip":    "192.168.52.1",
		"dest_port":  float64(62311),
		"flow": map[string]any{
			"src_ip":    "192.168.52.1",
			"src_port":  float64(62311),
			"dest_ip":   "192.168.52.148",
			"dest_port": float64(9200),
		},
	}

	event, err := FromRaw(raw)
	if err != nil {
		t.Fatalf("FromRaw returned error: %v", err)
	}
	if event.SrcIP != "192.168.52.1" || event.DestIP != "192.168.52.148" {
		t.Fatalf("unexpected normalized endpoints: src=%s dst=%s", event.SrcIP, event.DestIP)
	}
}

func TestFromRawFallsBackToTopLevelHTTPFields(t *testing.T) {
	raw := map[string]any{
		"event_type": "http",
		"http": map[string]any{
			"http_method": "GET",
			"url":         "/admin/login?next=%2F",
			"hostname":    "demo.internal",
			"status":      float64(404),
			"length":      float64(1234),
		},
	}

	event, err := FromRaw(raw)
	if err != nil {
		t.Fatalf("FromRaw returned error: %v", err)
	}
	if event.HTTPMethod != "GET" || event.HTTPURL != "/admin/login?next=%2F" || event.HTTPHost != "demo.internal" {
		t.Fatalf("unexpected http fields: %+v", event)
	}
	if event.HTTPStatus != 404 || event.HTTPLength != 1234 {
		t.Fatalf("unexpected http status/length: status=%d length=%d", event.HTTPStatus, event.HTTPLength)
	}
}

func TestFromRawPrefersCorrelatedHTTPFieldsOverTopLevelHTTP(t *testing.T) {
	raw := map[string]any{
		"event_type": "alert",
		"http": map[string]any{
			"http_method": "GET",
			"url":         "/raw-only",
			"hostname":    "raw.internal",
			"status":      float64(200),
			"length":      float64(100),
		},
		"correlated_http": map[string]any{
			"http": map[string]any{
				"http_method": "POST",
				"url":         "/preferred",
				"hostname":    "preferred.internal",
				"status":      float64(403),
				"length":      float64(200),
			},
		},
	}

	event, err := FromRaw(raw)
	if err != nil {
		t.Fatalf("FromRaw returned error: %v", err)
	}
	if event.HTTPMethod != "POST" || event.HTTPURL != "/preferred" || event.HTTPHost != "preferred.internal" {
		t.Fatalf("unexpected preferred http fields: %+v", event)
	}
	if event.HTTPStatus != 403 || event.HTTPLength != 200 {
		t.Fatalf("unexpected preferred http status/length: status=%d length=%d", event.HTTPStatus, event.HTTPLength)
	}
}

func TestCloneWithEnrichmentDoesNotMutateRaw(t *testing.T) {
	raw := map[string]any{"event_type": "alert"}
	event := ThreatEvent{Raw: raw, Enrichment: map[string]any{"attack_stage": "exploit"}}

	cloned := CloneWithEnrichment(event)
	if _, ok := raw["engine"]; ok {
		t.Fatal("CloneWithEnrichment mutated original raw event")
	}
	if _, ok := cloned["engine"]; !ok {
		t.Fatal("CloneWithEnrichment did not attach engine enrichment")
	}
}

func TestCloneWithEnrichmentNormalizesTopLevelEndpointsFromFlow(t *testing.T) {
	raw := map[string]any{
		"event_type": "alert",
		"direction":  "to_client",
		"src_ip":     "172.20.119.79",
		"src_port":   float64(8034),
		"dest_ip":    "27.18.168.234",
		"dest_port":  float64(43147),
		"flow": map[string]any{
			"src_ip":    "27.18.168.234",
			"src_port":  float64(43147),
			"dest_ip":   "172.20.119.79",
			"dest_port": float64(8034),
		},
	}

	cloned := CloneWithEnrichment(ThreatEvent{Raw: raw, Enrichment: map[string]any{"attack_stage": "confirmed_success"}})
	if cloned["src_ip"] != "27.18.168.234" || cloned["dest_ip"] != "172.20.119.79" {
		t.Fatalf("unexpected normalized endpoints: src=%v dst=%v", cloned["src_ip"], cloned["dest_ip"])
	}
	if cloned["src_port"] != 43147 || cloned["dest_port"] != 8034 {
		t.Fatalf("unexpected normalized ports: src=%v dst=%v", cloned["src_port"], cloned["dest_port"])
	}
}

func TestFromRawSwapsToClientEndpointsWithoutSessionFields(t *testing.T) {
	raw := map[string]any{
		"event_type": "alert",
		"direction":  "to_client",
		"src_ip":     "172.20.119.79",
		"src_port":   float64(8034),
		"dest_ip":    "27.18.168.234",
		"dest_port":  float64(43147),
	}

	event, err := FromRaw(raw)
	if err != nil {
		t.Fatalf("FromRaw returned error: %v", err)
	}
	if event.SrcIP != "27.18.168.234" || event.DestIP != "172.20.119.79" {
		t.Fatalf("unexpected normalized endpoints: src=%s dst=%s", event.SrcIP, event.DestIP)
	}
	if event.SrcPort != 43147 || event.DestPort != 8034 {
		t.Fatalf("unexpected normalized ports: src=%d dst=%d", event.SrcPort, event.DestPort)
	}
}
