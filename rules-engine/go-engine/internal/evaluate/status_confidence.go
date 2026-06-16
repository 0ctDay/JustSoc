package evaluate

import (
	"strings"

	"justsoc/engine/internal/normalize"
	"justsoc/engine/internal/rules"
)

func applyFrameworkStatusConfidence(event normalize.ThreatEvent, matchedRules []rules.Rule, attackStage string, attackSuccess bool, confidence string, reasons []string) (string, bool, string, []string) {
	if event.HTTPStatus == 0 || attackStage == "confirmed_success" {
		return attackStage, attackSuccess, confidence, reasons
	}

	isFramework := hasFrameworkRule(matchedRules) && isFrameworkURL(event.HTTPURL)

	switch event.HTTPStatus {
	case 404, 410:
		if attackStage == "probable_success" {
			attackStage = "attempt"
			attackSuccess = false
			confidence = "low"
			if isFramework {
				reasons = append(reasons, "framework_target_not_found")
			} else {
				reasons = append(reasons, "target_not_found")
			}
		}
	case 401, 403:
		if attackStage == "probable_success" {
			attackStage = "attempt"
			attackSuccess = false
			confidence = "medium"
			if isFramework {
				reasons = append(reasons, "framework_target_access_denied")
			} else {
				reasons = append(reasons, "target_access_denied")
			}
		}
	}
	return attackStage, attackSuccess, confidence, reasons
}

func hasFrameworkRule(matchedRules []rules.Rule) bool {
	for _, rule := range matchedRules {
		if strings.HasPrefix(rule.ID, "engine.struts2.") || strings.HasPrefix(rule.ID, "engine.spring.") || strings.HasPrefix(rule.ID, "engine.phpframework.") {
			return true
		}
	}
	return false
}

func isFrameworkURL(url string) bool {
	lower := strings.ToLower(url)
	frameworkPaths := []string{
		".action",
		"/struts",
		"/actuator/",
		"/php-cgi",
		"/cgi-bin/php",
		"invokefunction",
	}
	for _, path := range frameworkPaths {
		if strings.Contains(lower, path) {
			return true
		}
	}
	return false
}
