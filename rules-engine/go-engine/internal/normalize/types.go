package normalize

import (
	"fmt"
	"time"
)

type ThreatEvent struct {
	EventID                   string         `json:"event_id,omitempty"`
	Timestamp                 time.Time      `json:"timestamp_parsed,omitempty"`
	TimestampRaw              string         `json:"timestamp,omitempty"`
	EventType                 string         `json:"event_type,omitempty"`
	SrcIP                     string         `json:"src_ip,omitempty"`
	SrcPort                   int            `json:"src_port,omitempty"`
	DestIP                    string         `json:"dest_ip,omitempty"`
	DestPort                  int            `json:"dest_port,omitempty"`
	Proto                     string         `json:"proto,omitempty"`
	AppProto                  string         `json:"app_proto,omitempty"`
	FlowID                    string         `json:"flow_id,omitempty"`
	TxID                      string         `json:"tx_id,omitempty"`
	SensorID                  string         `json:"sensor_id,omitempty"`
	ProbeHost                 string         `json:"probe_host,omitempty"`
	AlertSignature            string         `json:"alert_signature,omitempty"`
	AlertSignatureID          int            `json:"alert_signature_id,omitempty"`
	Severity                  int            `json:"severity,omitempty"`
	HTTPMethod                string         `json:"http_method,omitempty"`
	HTTPURL                   string         `json:"http_url,omitempty"`
	HTTPHost                  string         `json:"http_host,omitempty"`
	HTTPStatus                int            `json:"http_status,omitempty"`
	HTTPLength                int            `json:"http_length,omitempty"`
	HTTPRequestBodyPrintable  string         `json:"http_request_body_printable,omitempty"`
	HTTPResponseBodyPrintable string         `json:"http_response_body_printable,omitempty"`
	DNSQuery                  string         `json:"dns_query,omitempty"`
	PayloadPrintable          string         `json:"payload_printable,omitempty"`
	EventOriginal             string         `json:"event_original,omitempty"`
	Raw                       map[string]any `json:"raw"`
	Enrichment                map[string]any `json:"engine,omitempty"`
}

func FromRaw(raw map[string]any) (ThreatEvent, error) {
	event := ThreatEvent{Raw: raw, Enrichment: map[string]any{}}
	if id, ok := raw["event_id"].(string); ok {
		event.EventID = id
	}
	if ts, ok := raw["timestamp"].(string); ok {
		event.TimestampRaw = ts
		parsed, err := time.Parse(time.RFC3339Nano, ts)
		if err == nil {
			event.Timestamp = parsed
		}
	}
	if eventType, ok := raw["event_type"].(string); ok {
		event.EventType = eventType
	}
	event.Proto = stringValue(raw, "proto")
	event.AppProto = stringValue(raw, "app_proto")
	event.FlowID = fmt.Sprintf("%v", raw["flow_id"])
	event.TxID = fmt.Sprintf("%v", raw["tx_id"])
	event.SensorID = stringValue(raw, "sensor_id")
	event.PayloadPrintable = stringValue(raw, "payload_printable")
	event.EventOriginal = nestedStringValue(raw, "event", "original")
	event.SrcIP, event.SrcPort, event.DestIP, event.DestPort = resolveSessionEndpoints(raw)

	if alert, ok := raw["alert"].(map[string]any); ok {
		event.AlertSignature = stringValue(alert, "signature")
		event.AlertSignatureID = intValue(alert, "signature_id")
		event.Severity = intValue(alert, "severity")
	}
	if probe, ok := raw["probe"].(map[string]any); ok {
		event.ProbeHost = stringValue(probe, "host")
	}
	hydrateHTTPFields(&event, raw)
	if dns, ok := raw["dns"].(map[string]any); ok {
		event.DNSQuery = stringValue(dns, "rrname")
	}
	return event, nil
}

func CloneWithEnrichment(event ThreatEvent) map[string]any {
	cloned := make(map[string]any, len(event.Raw)+1)
	for key, value := range event.Raw {
		cloned[key] = value
	}

	srcIP, srcPort, destIP, destPort := resolveSessionEndpoints(cloned)
	if srcIP != "" {
		cloned["src_ip"] = srcIP
	}
	if srcPort != 0 {
		cloned["src_port"] = srcPort
	}
	if destIP != "" {
		cloned["dest_ip"] = destIP
	}
	if destPort != 0 {
		cloned["dest_port"] = destPort
	}

	cloned["engine"] = event.Enrichment
	return cloned
}

func stringValue(values map[string]any, key string) string {
	if value, ok := values[key].(string); ok {
		return value
	}
	return ""
}

func intValue(values map[string]any, key string) int {
	switch value := values[key].(type) {
	case int:
		return value
	case int32:
		return int(value)
	case int64:
		return int(value)
	case float64:
		return int(value)
	default:
		return 0
	}
}

func nestedStringValue(values map[string]any, parent string, key string) string {
	child, ok := values[parent].(map[string]any)
	if !ok {
		return ""
	}
	return stringValue(child, key)
}

func hydrateHTTPFields(event *ThreatEvent, raw map[string]any) {
	if event == nil {
		return
	}
	if correlated, ok := raw["correlated_http"].(map[string]any); ok {
		if http, ok := correlated["http"].(map[string]any); ok {
			event.HTTPMethod = stringValue(http, "http_method")
			event.HTTPURL = stringValue(http, "url")
			event.HTTPHost = stringValue(http, "hostname")
			event.HTTPStatus = intValue(http, "status")
			event.HTTPLength = intValue(http, "length")
			event.HTTPRequestBodyPrintable = stringValue(http, "http_request_body_printable")
			event.HTTPResponseBodyPrintable = stringValue(http, "http_response_body_printable")
		}
	}
	if http, ok := raw["http"].(map[string]any); ok {
		if event.HTTPMethod == "" {
			event.HTTPMethod = stringValue(http, "http_method")
		}
		if event.HTTPURL == "" {
			event.HTTPURL = stringValue(http, "url")
		}
		if event.HTTPHost == "" {
			event.HTTPHost = stringValue(http, "hostname")
		}
		if event.HTTPStatus == 0 {
			event.HTTPStatus = intValue(http, "status")
		}
		if event.HTTPLength == 0 {
			event.HTTPLength = intValue(http, "length")
		}
		if event.HTTPRequestBodyPrintable == "" {
			event.HTTPRequestBodyPrintable = stringValue(http, "http_request_body_printable")
		}
		if event.HTTPResponseBodyPrintable == "" {
			event.HTTPResponseBodyPrintable = stringValue(http, "http_response_body_printable")
		}
	}
	if event.HTTPRequestBodyPrintable == "" {
		event.HTTPRequestBodyPrintable = stringValue(raw, "http-body-printable")
	}
	if event.HTTPResponseBodyPrintable == "" {
		event.HTTPResponseBodyPrintable = stringValue(raw, "http-response-body-printable")
	}
}

func resolveSessionEndpoints(raw map[string]any) (string, int, string, int) {
	srcIP := stringValue(raw, "src_ip")
	srcPort := intValue(raw, "src_port")
	destIP := stringValue(raw, "dest_ip")
	destPort := intValue(raw, "dest_port")
	usedSessionFields := false

	if correlated, ok := raw["correlated_http"].(map[string]any); ok {
		if value := stringValue(correlated, "src_ip"); value != "" {
			srcIP = value
			usedSessionFields = true
		}
		if value := intValue(correlated, "src_port"); value != 0 {
			srcPort = value
			usedSessionFields = true
		}
		if value := stringValue(correlated, "dest_ip"); value != "" {
			destIP = value
			usedSessionFields = true
		}
		if value := intValue(correlated, "dest_port"); value != 0 {
			destPort = value
			usedSessionFields = true
		}
	}

	if flow, ok := raw["flow"].(map[string]any); ok {
		if value := stringValue(flow, "src_ip"); value != "" {
			srcIP = value
			usedSessionFields = true
		}
		if value := intValue(flow, "src_port"); value != 0 {
			srcPort = value
			usedSessionFields = true
		}
		if value := stringValue(flow, "dest_ip"); value != "" {
			destIP = value
			usedSessionFields = true
		}
		if value := intValue(flow, "dest_port"); value != 0 {
			destPort = value
			usedSessionFields = true
		}
	}

	if !usedSessionFields && stringValue(raw, "direction") == "to_client" {
		return destIP, destPort, srcIP, srcPort
	}

	return srcIP, srcPort, destIP, destPort
}
