package whitelist

import (
	"encoding/json"
	"fmt"
	"net/netip"
	"os"
	"strings"

	"justsoc/engine/internal/normalize"
)

type Config struct {
	Rules []Rule `json:"rules"`
}

type Rule struct {
	Name          string   `json:"name"`
	SrcIP         []string `json:"src_ip"`
	DestIP        []string `json:"dest_ip"`
	SrcPort       []int    `json:"src_port"`
	DestPort      []int    `json:"dest_port"`
	HTTPURL       []string `json:"http_url"`
	HTTPURLPrefix []string `json:"http_url_prefix"`
}

type Matcher struct {
	enabled bool
	rules   []compiledRule
}

type compiledRule struct {
	name          string
	srcIPs        []netip.Prefix
	destIPs       []netip.Prefix
	srcPorts      map[int]struct{}
	destPorts     map[int]struct{}
	httpURLs      map[string]struct{}
	httpURLPrefix []string
}

func LoadFromEnv(envKey string) (*Matcher, string, error) {
	path := strings.TrimSpace(os.Getenv(envKey))
	if path == "" {
		return Disabled(), "", nil
	}
	matcher, err := Load(path)
	if err != nil {
		return nil, path, err
	}
	return matcher, path, nil
}

func Disabled() *Matcher {
	return &Matcher{}
}

func Load(path string) (*Matcher, error) {
	payload, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cfg Config
	if err := json.Unmarshal(payload, &cfg); err != nil {
		return nil, fmt.Errorf("parse whitelist: %w", err)
	}
	rules := make([]compiledRule, 0, len(cfg.Rules))
	for index, rule := range cfg.Rules {
		compiled, err := compileRule(index, rule)
		if err != nil {
			return nil, err
		}
		rules = append(rules, compiled)
	}
	return &Matcher{enabled: true, rules: rules}, nil
}

func (m *Matcher) Enabled() bool {
	return m != nil && m.enabled
}

func (m *Matcher) RuleCount() int {
	if m == nil {
		return 0
	}
	return len(m.rules)
}

func (m *Matcher) Match(event normalize.ThreatEvent) (bool, string) {
	if m == nil || !m.enabled {
		return false, ""
	}
	for _, rule := range m.rules {
		if rule.match(event) {
			return true, rule.name
		}
	}
	return false, ""
}

func compileRule(index int, rule Rule) (compiledRule, error) {
	name := strings.TrimSpace(rule.Name)
	if name == "" {
		name = fmt.Sprintf("rule-%d", index+1)
	}
	compiled := compiledRule{
		name:          name,
		srcPorts:      makePortSet(rule.SrcPort),
		destPorts:     makePortSet(rule.DestPort),
		httpURLs:      makeStringSet(rule.HTTPURL),
		httpURLPrefix: normalizeStrings(rule.HTTPURLPrefix),
	}
	var err error
	if compiled.srcIPs, err = compilePrefixes(rule.SrcIP); err != nil {
		return compiledRule{}, fmt.Errorf("compile src_ip for %s: %w", name, err)
	}
	if compiled.destIPs, err = compilePrefixes(rule.DestIP); err != nil {
		return compiledRule{}, fmt.Errorf("compile dest_ip for %s: %w", name, err)
	}
	if len(compiled.srcIPs) == 0 && len(compiled.destIPs) == 0 && len(compiled.srcPorts) == 0 && len(compiled.destPorts) == 0 && len(compiled.httpURLs) == 0 && len(compiled.httpURLPrefix) == 0 {
		return compiledRule{}, fmt.Errorf("rule %s has no match criteria", name)
	}
	return compiled, nil
}

func (r compiledRule) match(event normalize.ThreatEvent) bool {
	if len(r.srcIPs) > 0 && !matchIP(r.srcIPs, event.SrcIP) {
		return false
	}
	if len(r.destIPs) > 0 && !matchIP(r.destIPs, event.DestIP) {
		return false
	}
	if len(r.srcPorts) > 0 && !matchPort(r.srcPorts, event.SrcPort) {
		return false
	}
	if len(r.destPorts) > 0 && !matchPort(r.destPorts, event.DestPort) {
		return false
	}
	if len(r.httpURLs) > 0 {
		if _, ok := r.httpURLs[event.HTTPURL]; !ok {
			return false
		}
	}
	if len(r.httpURLPrefix) > 0 && !matchPrefix(r.httpURLPrefix, event.HTTPURL) {
		return false
	}
	return true
}

func compilePrefixes(values []string) ([]netip.Prefix, error) {
	prefixes := make([]netip.Prefix, 0, len(values))
	for _, raw := range values {
		value := strings.TrimSpace(raw)
		if value == "" {
			continue
		}
		if strings.Contains(value, "/") {
			prefix, err := netip.ParsePrefix(value)
			if err != nil {
				return nil, err
			}
			prefixes = append(prefixes, prefix.Masked())
			continue
		}
		addr, err := netip.ParseAddr(value)
		if err != nil {
			return nil, err
		}
		bits := 32
		if addr.Is6() {
			bits = 128
		}
		prefixes = append(prefixes, netip.PrefixFrom(addr, bits))
	}
	return prefixes, nil
}

func matchIP(prefixes []netip.Prefix, raw string) bool {
	addr, err := netip.ParseAddr(strings.TrimSpace(raw))
	if err != nil {
		return false
	}
	for _, prefix := range prefixes {
		if prefix.Contains(addr) {
			return true
		}
	}
	return false
}

func makePortSet(values []int) map[int]struct{} {
	if len(values) == 0 {
		return nil
	}
	result := make(map[int]struct{}, len(values))
	for _, value := range values {
		result[value] = struct{}{}
	}
	return result
}

func matchPort(ports map[int]struct{}, port int) bool {
	_, ok := ports[port]
	return ok
}

func makeStringSet(values []string) map[string]struct{} {
	if len(values) == 0 {
		return nil
	}
	result := make(map[string]struct{}, len(values))
	for _, value := range normalizeStrings(values) {
		result[value] = struct{}{}
	}
	return result
}

func normalizeStrings(values []string) []string {
	result := make([]string, 0, len(values))
	for _, raw := range values {
		value := strings.TrimSpace(raw)
		if value == "" {
			continue
		}
		result = append(result, value)
	}
	return result
}

func matchPrefix(prefixes []string, value string) bool {
	for _, prefix := range prefixes {
		if strings.HasPrefix(value, prefix) {
			return true
		}
	}
	return false
}
