package evaluate

import (
	"sort"
	"strings"

	"justsoc/engine/internal/normalize"
)

type fragment struct {
	Field string `json:"field"`
	Value string `json:"value"`
}

type fieldSource struct {
	name  string
	value string
	lower string
}

func buildHighlights(event normalize.ThreatEvent, reasons []string) ([]string, []map[string]string) {
	sources := collectSources(event)
	termSet := make(map[string]struct{})
	fragments := make([]fragment, 0)

	if profiles, err := loadHighlightProfiles(); err == nil {
		if profile, ok := profiles[event.AlertSignatureID]; ok {
			for _, term := range profile.terms {
				if sourceContainsTerm(sources, term) {
					termSet[term] = struct{}{}
					fragments = append(fragments, extractLiteralFragments(sources, profile.fields, term)...)
				}
			}
		}
	}

	for _, reason := range reasons {
		switch reason {
		case "sqli_error_response_observed":
			addReasonTerms(sources, termSet, &fragments, []string{"sql syntax", "xpath syntax error", "odbc sql server driver", "postgresql", "sqlite error", "ora-"}, "http.response")
		case "sensitive_file_content_returned":
			addReasonTerms(sources, termSet, &fragments, []string{"root:x:0:0:", "spring.datasource.", "server.port=", "<web-app", "[extensions]", "[boot loader]", "repositoryformatversion ="}, "http.response")
		case "command_output_observed":
			addReasonTerms(sources, termSet, &fragments, []string{"uid=", "gid=", "Directory of", "Microsoft Windows [Version", "Volume Serial Number", "NT AUTHORITY\\SYSTEM", "www-data"}, "http.response")
		case "dns_callback_observed", "http_callback_observed":
			for _, field := range []string{"http.request", "http.url", "dns.query"} {
				for _, term := range []string{"${jndi:", "${lower:j}", "${::-j}", "%24%7b", "dns://", "ldap://", "rmi://", "http://", "https://"} {
					if sourceContainsFieldTerm(sources, field, term) {
						termSet[term] = struct{}{}
						fragments = append(fragments, extractLiteralFragments(sources, []string{field}, term)...)
					}
				}
			}
		}
	}

	terms := make([]string, 0, len(termSet))
	for term := range termSet {
		terms = append(terms, term)
	}
	sort.Strings(terms)
	return terms, uniqueFragments(fragments)
}

func addReasonTerms(sources []fieldSource, termSet map[string]struct{}, fragments *[]fragment, terms []string, field string) {
	for _, term := range terms {
		if sourceContainsFieldTerm(sources, field, term) {
			termSet[term] = struct{}{}
			*fragments = append(*fragments, extractLiteralFragments(sources, []string{field}, term)...)
		}
	}
}

func collectSources(event normalize.ThreatEvent) []fieldSource {
	sources := make([]fieldSource, 0, 5)
	appendSource := func(name, value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		sources = append(sources, fieldSource{name: name, value: value, lower: strings.ToLower(value)})
	}
	appendSource("http.request", event.PayloadPrintable)
	appendSource("http.url", event.HTTPURL)
	appendSource("http.host", event.HTTPHost)
	appendSource("http.response", event.EventOriginal)
	appendSource("dns.query", event.DNSQuery)
	return sources
}

func sourceContainsTerm(sources []fieldSource, term string) bool {
	needle := strings.ToLower(term)
	for _, source := range sources {
		if strings.Contains(source.lower, needle) {
			return true
		}
	}
	return false
}

func sourceContainsFieldTerm(sources []fieldSource, field, term string) bool {
	needle := strings.ToLower(term)
	for _, source := range sources {
		if source.name != field {
			continue
		}
		if strings.Contains(source.lower, needle) {
			return true
		}
	}
	return false
}

func extractLiteralFragments(sources []fieldSource, fields []string, term string) []fragment {
	needle := strings.ToLower(term)
	result := make([]fragment, 0)
	for _, source := range sources {
		if !containsString(fields, source.name) {
			continue
		}
		start := 0
		for {
			index := strings.Index(source.lower[start:], needle)
			if index == -1 {
				break
			}
			begin := start + index
			end := begin + len(needle)
			if end > len(source.value) {
				end = len(source.value)
			}
			result = append(result, fragment{Field: source.name, Value: source.value[begin:end]})
			start = end
			if start >= len(source.value) {
				break
			}
		}
	}
	return result
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func uniqueFragments(values []fragment) []map[string]string {
	seen := make(map[string]struct{}, len(values))
	result := make([]map[string]string, 0, len(values))
	for _, value := range values {
		if value.Field == "" || value.Value == "" {
			continue
		}
		key := value.Field + "\x00" + value.Value
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, map[string]string{"field": value.Field, "value": value.Value})
		if len(result) >= 12 {
			break
		}
	}
	return result
}
