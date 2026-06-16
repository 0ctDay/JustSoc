package sink

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type ESWriter struct {
	endpoint   string
	indexAlias string
	client     *http.Client
}

type bulkResponse struct {
	Errors bool                          `json:"errors"`
	Items  []map[string]bulkResponseItem `json:"items"`
}

type bulkResponseItem struct {
	Status int         `json:"status"`
	Error  interface{} `json:"error"`
}

func NewESWriter(endpoint string, indexAlias string) *ESWriter {
	return &ESWriter{
		endpoint:   strings.TrimRight(endpoint, "/"),
		indexAlias: indexAlias,
		client:     &http.Client{},
	}
}

func NewESWriterFromEnv() *ESWriter {
	endpoint := envOrDefault("SELK_ES_ENDPOINT", "http://127.0.0.1:9200")
	indexAlias := envOrDefault("SELK_ENGINE_ES_INDEX", "selk-alerts-write")
	return NewESWriter(endpoint, indexAlias)
}

func (w *ESWriter) Write(ctx context.Context, event map[string]any) error {
	return w.WriteBatch(ctx, []map[string]any{event})
}

func (w *ESWriter) WriteBatch(ctx context.Context, events []map[string]any) error {
	if len(events) == 0 {
		return nil
	}

	var body bytes.Buffer
	for _, event := range events {
		document := enrichDocumentForES(event)
		indexAlias := resolveIndexAlias(w.indexAlias, document)

		actionPayload, err := json.Marshal(map[string]any{
			"index": map[string]any{"_index": indexAlias},
		})
		if err != nil {
			return err
		}
		documentPayload, err := json.Marshal(document)
		if err != nil {
			return err
		}

		body.Write(actionPayload)
		body.WriteByte('\n')
		body.Write(documentPayload)
		body.WriteByte('\n')
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, fmt.Sprintf("%s/_bulk", w.endpoint), &body)
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/x-ndjson")

	response, err := w.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	payload, err := io.ReadAll(response.Body)
	if err != nil {
		return err
	}
	if response.StatusCode >= 300 {
		return fmt.Errorf("es bulk write failed with status %s: %s", response.Status, strings.TrimSpace(string(payload)))
	}

	var bulk bulkResponse
	if err := json.Unmarshal(payload, &bulk); err != nil {
		return fmt.Errorf("decode es bulk response: %w", err)
	}
	if !bulk.Errors {
		return nil
	}

	for _, item := range bulk.Items {
		for action, result := range item {
			if result.Status < 300 {
				continue
			}
			return fmt.Errorf("es bulk %s failed with status %d: %v", action, result.Status, result.Error)
		}
	}
	return fmt.Errorf("es bulk write reported errors without item details")
}

func (w *ESWriter) Close() error {
	return nil
}

func enrichDocumentForES(event map[string]any) map[string]any {
	document := cloneMap(event)
	ts := selectEventTimestamp(document)
	document["@timestamp"] = ts.Format(time.RFC3339Nano)

	setNestedValue(document, []string{"event", "dataset"}, "selk.suricata")
	setNestedValue(document, []string{"observer", "type"}, "ids")

	if sensorID := stringValue(document, "sensor_id"); sensorID != "" {
		setNestedValue(document, []string{"observer", "name"}, sensorID)
	}
	srcIP, srcPort, destIP, destPort := resolveSessionEndpoints(document)
	if srcIP != "" {
		setNestedValue(document, []string{"source", "ip"}, srcIP)
	}
	if destIP != "" {
		setNestedValue(document, []string{"destination", "ip"}, destIP)
	}
	if srcPort != nil {
		setNestedValue(document, []string{"source", "port"}, srcPort)
	}
	if destPort != nil {
		setNestedValue(document, []string{"destination", "port"}, destPort)
	}
	if proto := stringValue(document, "proto"); proto != "" {
		setNestedValue(document, []string{"network", "transport"}, strings.ToLower(proto))
	}
	if appProto := stringValue(document, "app_proto"); appProto != "" {
		setNestedValue(document, []string{"network", "protocol"}, strings.ToLower(appProto))
	}
	if alert, ok := document["alert"].(map[string]any); ok {
		if signature := stringValue(alert, "signature"); signature != "" {
			setNestedValue(document, []string{"rule", "name"}, signature)
		}
		if signatureID := scalarValue(alert, "signature_id"); signatureID != nil {
			setNestedValue(document, []string{"rule", "id"}, formatScalarString(signatureID))
		}
		if severity := scalarValue(alert, "severity"); severity != nil {
			setNestedValue(document, []string{"event", "severity"}, severityLabel(severity))
		}
	}

	return document
}

func resolveIndexAlias(pattern string, document map[string]any) string {
	const dailyPattern = "%{+YYYY.MM.dd}"
	if !strings.Contains(pattern, dailyPattern) {
		return pattern
	}
	return strings.ReplaceAll(pattern, dailyPattern, selectEventTimestamp(document).Format("2006.01.02"))
}

func selectEventTimestamp(document map[string]any) time.Time {
	for _, key := range []string{"timestamp", "ingested_at", "@timestamp"} {
		if value := stringValue(document, key); value != "" {
			if ts, ok := parseTimestamp(value); ok {
				return ts.UTC()
			}
		}
	}
	return time.Now().UTC()
}

func parseTimestamp(value string) (time.Time, bool) {
	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02T15:04:05.999999999-0700",
		"2006-01-02T15:04:05-0700",
	}
	for _, layout := range layouts {
		if ts, err := time.Parse(layout, value); err == nil {
			return ts, true
		}
	}
	return time.Time{}, false
}

func cloneMap(source map[string]any) map[string]any {
	cloned := make(map[string]any, len(source))
	for key, value := range source {
		cloned[key] = cloneAny(value)
	}
	return cloned
}

func cloneAny(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		return cloneMap(typed)
	case []any:
		cloned := make([]any, len(typed))
		for i, item := range typed {
			cloned[i] = cloneAny(item)
		}
		return cloned
	default:
		return value
	}
}

func setNestedValue(document map[string]any, path []string, value any) {
	current := document
	for i := 0; i < len(path)-1; i++ {
		key := path[i]
		next, ok := current[key].(map[string]any)
		if !ok {
			next = map[string]any{}
			current[key] = next
		}
		current = next
	}
	current[path[len(path)-1]] = value
}

func resolveSessionEndpoints(document map[string]any) (string, any, string, any) {
	srcIP := stringValue(document, "src_ip")
	srcPort := scalarValue(document, "src_port")
	destIP := stringValue(document, "dest_ip")
	destPort := scalarValue(document, "dest_port")

	if correlated, ok := document["correlated_http"].(map[string]any); ok {
		if value := stringValue(correlated, "src_ip"); value != "" {
			srcIP = value
		}
		if value := scalarValue(correlated, "src_port"); value != nil {
			srcPort = value
		}
		if value := stringValue(correlated, "dest_ip"); value != "" {
			destIP = value
		}
		if value := scalarValue(correlated, "dest_port"); value != nil {
			destPort = value
		}
	}

	if flow, ok := document["flow"].(map[string]any); ok {
		if value := stringValue(flow, "src_ip"); value != "" {
			srcIP = value
		}
		if value := scalarValue(flow, "src_port"); value != nil {
			srcPort = value
		}
		if value := stringValue(flow, "dest_ip"); value != "" {
			destIP = value
		}
		if value := scalarValue(flow, "dest_port"); value != nil {
			destPort = value
		}
	}

	return srcIP, srcPort, destIP, destPort
}

func stringValue(values map[string]any, key string) string {
	if value, ok := values[key].(string); ok {
		return value
	}
	return ""
}

func scalarValue(values map[string]any, key string) any {
	if value, ok := values[key]; ok {
		switch value.(type) {
		case string, float64, float32, int, int32, int64, uint, uint32, uint64:
			return value
		}
	}
	return nil
}

func formatScalarString(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case float64:
		return fmt.Sprintf("%.0f", typed)
	case float32:
		return fmt.Sprintf("%.0f", typed)
	case int:
		return fmt.Sprintf("%d", typed)
	case int32:
		return fmt.Sprintf("%d", typed)
	case int64:
		return fmt.Sprintf("%d", typed)
	case uint:
		return fmt.Sprintf("%d", typed)
	case uint32:
		return fmt.Sprintf("%d", typed)
	case uint64:
		return fmt.Sprintf("%d", typed)
	default:
		return fmt.Sprintf("%v", value)
	}
}

func severityLabel(value any) string {
	severity := 4
	switch typed := value.(type) {
	case string:
		_, _ = fmt.Sscanf(strings.TrimSpace(typed), "%d", &severity)
	case float64:
		severity = int(typed)
	case float32:
		severity = int(typed)
	case int:
		severity = typed
	case int32:
		severity = int(typed)
	case int64:
		severity = int(typed)
	case uint:
		severity = int(typed)
	case uint32:
		severity = int(typed)
	case uint64:
		severity = int(typed)
	}

	switch {
	case severity <= 1:
		return "紧急"
	case severity == 2:
		return "高危"
	case severity == 3:
		return "中危"
	default:
		return "低危"
	}
}
