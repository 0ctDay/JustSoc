package evaluate

import (
	"regexp"
	"strings"

	"justsoc/engine/internal/normalize"
)

var directJNDIPattern = regexp.MustCompile(`(?i)\$\{jndi:(?:ldap|ldaps|rmi|dns|iiop|nis|http|https):(?://)?([^/}:\s]+)`)
var nestedJNDIPattern = regexp.MustCompile(`(?i)\$\{[^\r\n]{0,160}jndi[^\r\n]{0,80}(?:ldap|ldaps|rmi|dns|iiop|nis|http|https):(?://)?([^/}:\s]+)`)
var encodedJNDIPattern = regexp.MustCompile(`(?i)(?:%24%7b|\$\{)jndi(?::|%3a)(?:ldap|ldaps|rmi|dns|iiop|nis|http|https)(?::|%3a)(?://|%2f%2f)?([^/%}:\s]+)`)
var jndiNormalizer = strings.NewReplacer(
	"${lower:j}", "j",
	"${lower:n}", "n",
	"${lower:d}", "d",
	"${lower:i}", "i",
	"${upper:j}", "j",
	"${upper:n}", "n",
	"${upper:d}", "d",
	"${upper:i}", "i",
	"${::-j}", "j",
	"${::-n}", "n",
	"${::-d}", "d",
	"${::-i}", "i",
)

func callbackDomains(event normalize.ThreatEvent) []string {
	payload := strings.ToLower(event.PayloadPrintable + " " + event.HTTPURL + " " + event.HTTPHost)
	normalized := jndiNormalizer.Replace(payload)
	directMatches := directJNDIPattern.FindAllStringSubmatch(normalized, -1)
	nestedMatches := nestedJNDIPattern.FindAllStringSubmatch(normalized, -1)
	encodedMatches := encodedJNDIPattern.FindAllStringSubmatch(payload, -1)
	if len(directMatches) == 0 && len(nestedMatches) == 0 && len(encodedMatches) == 0 {
		return nil
	}
	domains := make([]string, 0, len(directMatches)+len(nestedMatches)+len(encodedMatches))
	for _, match := range append(append(directMatches, nestedMatches...), encodedMatches...) {
		if len(match) < 2 {
			continue
		}
		domain := strings.ToLower(strings.TrimSpace(match[1]))
		domain = strings.TrimSuffix(domain, ".")
		if domain != "" {
			domains = append(domains, domain)
		}
	}
	return uniqueDomains(domains)
}

func containsSensitiveFileContent(event normalize.ThreatEvent) bool {
	payload := strings.ToLower(responseEvidenceText(event))
	markers := []string{
		"root:x:0:0:",
		"daemon:x:1:1:",
		"nobody:x:",
		"/bin/bash",
		"/bin/sh",
		"localhost.localdomain",
		"[extensions]",
		"[fonts]",
		"[mci extensions]",
		"[boot loader]",
		"spring.datasource.",
		"spring.datasource.url=",
		"server.port=",
		"<web-app",
		"[core]",
		"repositoryformatversion =",
		"user.name =",
		"user.email =",
		"-----begin openssh private key-----",
		"ssh-rsa ",
		"db_password=",
		"db.username=",
	}
	for _, marker := range markers {
		if strings.Contains(payload, marker) {
			return true
		}
	}
	return false
}

func containsCommandOutput(event normalize.ThreatEvent) bool {
	payload := strings.ToLower(responseEvidenceText(event))
	markers := []string{
		"uid=0(",
		"gid=0(",
		"groups=0(",
		"uid=",
		"gid=",
		"linux ",
		"volume serial number",
		"directory of c:\\",
		"microsoft windows [version",
		"program files",
		"nt authority\\system",
		"inetpub\\wwwroot",
		"administrator",
		"www-data",
	}
	for _, marker := range markers {
		if strings.Contains(payload, marker) {
			return true
		}
	}
	return false
}

func responseEvidenceText(event normalize.ThreatEvent) string {
	parts := make([]string, 0, 2)
	if value := strings.TrimSpace(event.HTTPResponseBodyPrintable); value != "" {
		parts = append(parts, value)
	}
	if value := strings.TrimSpace(event.EventOriginal); value != "" && !looksLikeHTTPRequest(value) {
		parts = append(parts, value)
	}
	return strings.Join(parts, "\n")
}

func looksLikeHTTPRequest(value string) bool {
	lower := strings.ToLower(strings.TrimSpace(value))
	for _, method := range []string{"get ", "post ", "put ", "delete ", "head ", "options ", "patch ", "trace ", "connect "} {
		if strings.HasPrefix(lower, method) {
			return true
		}
	}
	return false
}

func uniqueDomains(domains []string) []string {
	seen := make(map[string]struct{}, len(domains))
	result := make([]string, 0, len(domains))
	for _, domain := range domains {
		if domain == "" {
			continue
		}
		if _, ok := seen[domain]; ok {
			continue
		}
		seen[domain] = struct{}{}
		result = append(result, domain)
	}
	return result
}
