package evaluate

import (
	"fmt"
	"net/url"
	"path"
	"strings"
	"time"

	"justsoc/engine/internal/correlate"
	"justsoc/engine/internal/normalize"
	"justsoc/engine/internal/rules"
)

const (
	directoryScanWindow             = time.Minute
	directoryScanDistinctThreshold  = 12
	directoryScanErrorRatioMinimum  = 0.7
	engineGeneratedDirectoryScanSID = 2900001
)

var directoryScanMethods = map[string]struct{}{
	"GET":     {},
	"HEAD":    {},
	"OPTIONS": {},
}

var directoryScanStaticExtensions = map[string]struct{}{
	".css":   {},
	".gif":   {},
	".ico":   {},
	".jpeg":  {},
	".jpg":   {},
	".js":    {},
	".map":   {},
	".png":   {},
	".svg":   {},
	".woff":  {},
	".woff2": {},
}

type Evaluator struct {
	rules              []rules.Rule
	store              *correlate.Store
	directoryScanStore *correlate.Store
}

type directoryScanObservation struct {
	TotalRequests int
	DistinctPaths int
	ErrorRequests int
	ErrorRatio    float64
	Target        string
	Path          string
}

type directoryScanAlertMetadata struct {
	Signature string
	Category  string
	Action    string
	SID       int
	Severity  int
	Labels    []string
}

func New(ruleSet []rules.Rule, store *correlate.Store) *Evaluator {
	return &Evaluator{
		rules:              ruleSet,
		store:              store,
		directoryScanStore: correlate.NewStore(directoryScanWindow),
	}
}

func (e *Evaluator) Evaluate(event normalize.ThreatEvent) map[string]any {
	matchedRules := make([]string, 0)
	matchedRuleDefs := make([]rules.Rule, 0)
	reasons := make([]string, 0)
	categories := make(map[string]struct{})
	attackStage := "attempt"
	confidence := "low"
	attackSuccess := false
	seenAt := event.Timestamp
	if seenAt.IsZero() {
		seenAt = time.Now().UTC()
	}

	if category := categoryFromSID(event.AlertSignatureID); category != "" {
		categories[category] = struct{}{}
		confidence = "medium"
	}
	if reason, ok := successHintReason(event.AlertSignatureID); ok {
		if category := successHintCategory(event.AlertSignatureID); category != "" {
			categories[category] = struct{}{}
		}
		attackStage = "confirmed_success"
		attackSuccess = true
		confidence = "high"
		reasons = append(reasons, reason)
	}

	for _, rule := range e.rules {
		if !rule.Match(event) {
			continue
		}
		if rule.Category != "" {
			categories[rule.Category] = struct{}{}
		}
		matchedRuleDefs = append(matchedRuleDefs, rule)
		matchedRules = append(matchedRules, rule.ID)
		if rule.Stage == "confirmed_success" || rule.Stage == "probable_success" {
			reasons = append(reasons, rule.Reason)
		}
	}

	attackStage, attackSuccess, confidence = applyRuleSignals(matchedRuleDefs, attackStage, attackSuccess, confidence)

	for _, ruleID := range matchedRules {
		key := fmt.Sprintf("repeat|%s|%s|%s|%s|%s", event.SrcIP, event.DestIP, event.HTTPURL, event.AlertSignature, ruleID)
		if e.store != nil && e.store.Observe(key, seenAt) > 0 {
			attackStage = "probable_success"
			attackSuccess = true
			confidence = "high"
			reasons = append(reasons, "repeated_attack_pattern_observed")
		}
	}

	for _, domain := range callbackDomains(event) {
		if e.store != nil {
			e.store.Remember("log4j-domain", domain, seenAt)
		}
	}

	if event.DNSQuery != "" && e.store != nil && e.store.SeenValue("log4j-domain", event.DNSQuery, seenAt) {
		attackStage = "confirmed_success"
		attackSuccess = true
		confidence = "high"
		reasons = append(reasons, "dns_callback_observed")
	}
	if event.HTTPHost != "" && e.store != nil && e.store.SeenValue("log4j-domain", event.HTTPHost, seenAt) {
		attackStage = "confirmed_success"
		attackSuccess = true
		confidence = "high"
		reasons = append(reasons, "http_callback_observed")
	}
	if containsSensitiveFileContent(event) {
		attackStage = "confirmed_success"
		attackSuccess = true
		confidence = "high"
		reasons = append(reasons, "sensitive_file_content_returned")
	}
	if containsCommandOutput(event) {
		attackStage = "confirmed_success"
		attackSuccess = true
		confidence = "high"
		reasons = append(reasons, "command_output_observed")
	}

	directoryScan, directoryScanDetected := e.detectDirectoryScan(event, seenAt)

	attackStage, attackSuccess, confidence, reasons = applyFrameworkStatusConfidence(event, matchedRuleDefs, attackStage, attackSuccess, confidence, reasons)

	uniqueReasons := uniqueStrings(reasons)
	matchTerms, matchFragments := buildHighlights(event, uniqueReasons)

	event.Enrichment["attack_stage"] = attackStage
	event.Enrichment["attack_success"] = attackSuccess
	event.Enrichment["attack_success_confidence"] = confidence
	event.Enrichment["attack_success_reason"] = uniqueReasons
	event.Enrichment["engine_matches"] = matchedRules
	event.Enrichment["match_terms"] = matchTerms
	event.Enrichment["match_fragments"] = matchFragments
	if directoryScanDetected {
		event.Enrichment["behavior"] = "directory_scan"
		event.Enrichment["directory_scan"] = map[string]any{
			"distinct_paths": directoryScan.DistinctPaths,
			"total_requests": directoryScan.TotalRequests,
			"error_requests": directoryScan.ErrorRequests,
			"error_ratio":    directoryScan.ErrorRatio,
			"target":         directoryScan.Target,
			"path":           directoryScan.Path,
		}
		applyDirectoryScanAlertShape(event.Raw, directoryScan)
	}
	event.Enrichment["engine_version"] = "v0.4.0"
	event.Enrichment["engine_timestamp"] = time.Now().UTC().Format(time.RFC3339Nano)

	return normalize.CloneWithEnrichment(event)
}

func categoryFromSID(sid int) string {
	switch {
	case sid >= 1000001 && sid <= 1000099:
		return "sqli"
	case sid >= 1001001 && sid <= 1001099:
		return "xss"
	case sid >= 1002001 && sid <= 1002099:
		return "cmdi"
	case sid >= 1002101 && sid <= 1002199:
		return "rce"
	case sid >= 1003001 && sid <= 1003099:
		return "file_read"
	case sid >= 1004001 && sid <= 1004099:
		return "upload"
	case sid >= 1005001 && sid <= 1005099:
		return "shiro"
	case sid >= 1006001 && sid <= 1006099:
		return "log4j"
	case sid >= 1007001 && sid <= 1007099:
		return "fastjson"
	default:
		return ""
	}
}

func successHintReason(sid int) (string, bool) {
	switch sid {
	case 1009001:
		return "sqli_error_response_observed", true
	case 1009003, 1009006:
		return "sensitive_file_content_returned", true
	case 1009004, 1009005:
		return "command_output_observed", true
	default:
		return "", false
	}
}

func successHintCategory(sid int) string {
	switch sid {
	case 1009001:
		return "sqli"
	case 1009003, 1009006:
		return "file_read"
	case 1009004, 1009005:
		return "cmdi"
	default:
		return ""
	}
}

func applyRuleSignals(matchedRules []rules.Rule, attackStage string, attackSuccess bool, confidence string) (string, bool, string) {
	for _, rule := range matchedRules {
		switch rule.Stage {
		case "confirmed_success":
			attackStage = "confirmed_success"
			attackSuccess = true
			confidence = "high"
		case "probable_success":
			if attackStage != "confirmed_success" {
				attackStage = "probable_success"
				attackSuccess = true
				confidence = "high"
			}
		case "attempt":
			if rule.SuccessSignal && confidence == "low" {
				confidence = "medium"
			}
		}
	}
	return attackStage, attackSuccess, confidence
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func (e *Evaluator) detectDirectoryScan(event normalize.ThreatEvent, seenAt time.Time) (directoryScanObservation, bool) {
	if e == nil || e.directoryScanStore == nil {
		return directoryScanObservation{}, false
	}
	if !shouldTrackDirectoryScan(event) {
		return directoryScanObservation{}, false
	}

	normalizedPath := normalizeDirectoryScanPath(event.HTTPURL)
	if normalizedPath == "" || isStaticDirectoryScanPath(normalizedPath) {
		return directoryScanObservation{}, false
	}
	target := directoryScanTarget(event)
	if target == "" {
		return directoryScanObservation{}, false
	}

	bucket := fmt.Sprintf("directory_scan|%s|%s", strings.ToLower(strings.TrimSpace(event.SrcIP)), target)
	totalBefore, distinctPaths := e.directoryScanStore.ObserveDistinct(bucket+"|paths", normalizedPath, seenAt)
	totalRequests := totalBefore + 1

	errorRequests := e.directoryScanStore.Count(bucket+"|errors", seenAt)
	if isDirectoryScanErrorStatus(event.HTTPStatus) {
		errorRequests = e.directoryScanStore.Observe(bucket+"|errors", seenAt) + 1
	}

	errorRatio := 0.0
	if totalRequests > 0 {
		errorRatio = float64(errorRequests) / float64(totalRequests)
	}

	observation := directoryScanObservation{
		TotalRequests: totalRequests,
		DistinctPaths: distinctPaths,
		ErrorRequests: errorRequests,
		ErrorRatio:    errorRatio,
		Target:        target,
		Path:          normalizedPath,
	}
	if distinctPaths < directoryScanDistinctThreshold {
		return observation, false
	}
	if errorRatio < directoryScanErrorRatioMinimum {
		return observation, false
	}
	return observation, true
}

func shouldTrackDirectoryScan(event normalize.ThreatEvent) bool {
	if strings.TrimSpace(event.SrcIP) == "" {
		return false
	}
	method := strings.ToUpper(strings.TrimSpace(event.HTTPMethod))
	if _, ok := directoryScanMethods[method]; !ok {
		return false
	}
	return strings.TrimSpace(event.HTTPURL) != ""
}

func normalizeDirectoryScanPath(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return ""
	}
	if parsed, err := url.Parse(value); err == nil {
		switch {
		case parsed.Path != "":
			value = parsed.Path
		case parsed.Opaque != "":
			value = parsed.Opaque
		}
	}
	if idx := strings.IndexAny(value, "?#"); idx >= 0 {
		value = value[:idx]
	}
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if !strings.HasPrefix(value, "/") {
		value = "/" + value
	}
	value = strings.ToLower(value)
	if len(value) > 1 {
		value = strings.TrimRight(value, "/")
		if value == "" {
			value = "/"
		}
	}
	return value
}

func isStaticDirectoryScanPath(normalizedPath string) bool {
	ext := strings.ToLower(path.Ext(normalizedPath))
	_, ok := directoryScanStaticExtensions[ext]
	return ok
}

func directoryScanTarget(event normalize.ThreatEvent) string {
	if host := strings.ToLower(strings.TrimSpace(event.HTTPHost)); host != "" {
		return host
	}
	if strings.TrimSpace(event.DestIP) == "" {
		return ""
	}
	if event.DestPort == 0 {
		return event.DestIP
	}
	return fmt.Sprintf("%s:%d", event.DestIP, event.DestPort)
}

func isDirectoryScanErrorStatus(status int) bool {
	switch status {
	case 401, 403, 404:
		return true
	default:
		return false
	}
}

func applyDirectoryScanAlertShape(raw map[string]any, observation directoryScanObservation) {
	if raw == nil {
		return
	}
	metadata := directoryScanAlertDetails(observation)
	raw["event_type"] = "alert"
	if _, ok := raw["alert"].(map[string]any); !ok {
		raw["alert"] = map[string]any{
			"signature":    metadata.Signature,
			"signature_id": metadata.SID,
			"category":     metadata.Category,
			"severity":     metadata.Severity,
			"action":       metadata.Action,
			"metadata": map[string]any{
				"selk_category": metadata.Labels,
			},
		}
	}
	if _, ok := raw["rule"].(map[string]any); !ok {
		raw["rule"] = map[string]any{
			"id":   fmt.Sprintf("%d", metadata.SID),
			"name": metadata.Signature,
		}
	}
	setNestedMapValue(raw, []string{"event", "severity"}, severityLabelFromInt(metadata.Severity))
}

func directoryScanAlertDetails(observation directoryScanObservation) directoryScanAlertMetadata {
	signature := "目录扫描行为：短时间多路径探测"
	if observation.Target != "" {
		signature = fmt.Sprintf("目录扫描行为：%s 短时间多路径探测", observation.Target)
	}
	return directoryScanAlertMetadata{
		Signature: signature,
		Category:  "Web Application Attack",
		Action:    "allowed",
		SID:       engineGeneratedDirectoryScanSID,
		Severity:  2,
		Labels:    []string{"目录扫描"},
	}
}

func setNestedMapValue(root map[string]any, path []string, value any) {
	if len(path) == 0 || root == nil {
		return
	}
	current := root
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

func severityLabelFromInt(severity int) string {
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
