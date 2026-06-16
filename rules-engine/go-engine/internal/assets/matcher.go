package assets

import (
	"fmt"
	"net/netip"
	"os"
	"sort"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

type document struct {
	SchemaVersion int     `yaml:"schema_version"`
	Version       string  `yaml:"version"`
	Entries       []entry `yaml:"entries"`
}

type entry struct {
	AssetID   string    `yaml:"asset_id"`
	AssetName string    `yaml:"asset_name"`
	Enabled   *bool     `yaml:"enabled"`
	Bindings  []binding `yaml:"bindings"`
}

type binding struct {
	BindingID   string `yaml:"binding_id"`
	MatchType   string `yaml:"match_type"`
	MatchValue  string `yaml:"match_value"`
	NetworkType string `yaml:"network_type"`
	Priority    int    `yaml:"priority"`
	Enabled     *bool  `yaml:"enabled"`
}

type Match struct {
	AssetID     string
	AssetName   string
	BindingID   string
	MatchType   string
	MatchValue  string
	NetworkType string
	Priority    int
}

type compiledBinding struct {
	match  Match
	prefix netip.Prefix
	exact  bool
}

type Matcher struct {
	version  string
	exact    map[netip.Addr][]compiledBinding
	prefixes []compiledBinding
}

func Disabled() *Matcher {
	return &Matcher{exact: map[netip.Addr][]compiledBinding{}}
}

func LoadFile(path string) (*Matcher, error) {
	payload, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return Parse(payload)
}

func Parse(payload []byte) (*Matcher, error) {
	var doc document
	if err := yaml.Unmarshal(payload, &doc); err != nil {
		return nil, fmt.Errorf("parse asset yaml: %w", err)
	}
	if doc.SchemaVersion < 1 {
		return nil, fmt.Errorf("schema_version must be a positive integer")
	}
	doc.Version = strings.TrimSpace(doc.Version)
	if doc.Version == "" {
		return nil, fmt.Errorf("version is required")
	}
	if doc.Entries == nil {
		return nil, fmt.Errorf("entries must be a list")
	}

	matcher := &Matcher{
		version: doc.Version,
		exact:   map[netip.Addr][]compiledBinding{},
	}
	assetIDs := map[string]struct{}{}
	bindingIDs := map[string]struct{}{}

	for assetIndex, asset := range doc.Entries {
		assetEnabled := boolPtrValue(asset.Enabled, true)
		assetID := strings.TrimSpace(asset.AssetID)
		assetName := strings.TrimSpace(asset.AssetName)
		if assetID == "" {
			return nil, fmt.Errorf("entries[%d].asset_id is required", assetIndex)
		}
		if _, exists := assetIDs[assetID]; exists {
			return nil, fmt.Errorf("duplicate asset_id: %s", assetID)
		}
		assetIDs[assetID] = struct{}{}
		if assetName == "" {
			return nil, fmt.Errorf("entries[%d].asset_name is required", assetIndex)
		}
		if len(asset.Bindings) == 0 {
			return nil, fmt.Errorf("entries[%d].bindings must be a non-empty list", assetIndex)
		}

		for bindingIndex, rawBinding := range asset.Bindings {
			bindingEnabled := boolPtrValue(rawBinding.Enabled, true)
			compiled, err := compileBinding(assetIndex, bindingIndex, assetID, assetName, rawBinding)
			if err != nil {
				return nil, err
			}
			if _, exists := bindingIDs[compiled.match.BindingID]; exists {
				return nil, fmt.Errorf("duplicate binding_id: %s", compiled.match.BindingID)
			}
			bindingIDs[compiled.match.BindingID] = struct{}{}
			if !assetEnabled || !bindingEnabled {
				continue
			}

			if compiled.exact {
				addr := compiled.prefix.Addr()
				matcher.exact[addr] = append(matcher.exact[addr], compiled)
			} else {
				matcher.prefixes = append(matcher.prefixes, compiled)
			}
		}
	}

	for addr := range matcher.exact {
		sortBindings(matcher.exact[addr])
	}
	sortBindings(matcher.prefixes)
	return matcher, nil
}

func compileBinding(assetIndex int, bindingIndex int, assetID string, assetName string, raw binding) (compiledBinding, error) {
	bindingID := strings.TrimSpace(raw.BindingID)
	matchType := strings.ToLower(strings.TrimSpace(raw.MatchType))
	matchValue := strings.TrimSpace(raw.MatchValue)
	networkType := strings.ToLower(strings.TrimSpace(raw.NetworkType))

	if bindingID == "" {
		return compiledBinding{}, fmt.Errorf("entries[%d].bindings[%d].binding_id is required", assetIndex, bindingIndex)
	}
	if matchType != "ip" && matchType != "cidr" {
		return compiledBinding{}, fmt.Errorf("entries[%d].bindings[%d].match_type must be ip or cidr", assetIndex, bindingIndex)
	}
	if matchValue == "" {
		return compiledBinding{}, fmt.Errorf("entries[%d].bindings[%d].match_value is required", assetIndex, bindingIndex)
	}
	if networkType != "internal" && networkType != "external" {
		return compiledBinding{}, fmt.Errorf("entries[%d].bindings[%d].network_type must be internal or external", assetIndex, bindingIndex)
	}

	var prefix netip.Prefix
	var err error
	exact := matchType == "ip"
	if exact {
		addr, parseErr := netip.ParseAddr(matchValue)
		if parseErr != nil {
			return compiledBinding{}, fmt.Errorf("entries[%d].bindings[%d].match_value is invalid: %w", assetIndex, bindingIndex, parseErr)
		}
		bits := 32
		if addr.Is6() {
			bits = 128
		}
		prefix = netip.PrefixFrom(addr, bits)
	} else {
		prefix, err = netip.ParsePrefix(matchValue)
		if err != nil {
			return compiledBinding{}, fmt.Errorf("entries[%d].bindings[%d].match_value is invalid: %w", assetIndex, bindingIndex, err)
		}
		prefix = prefix.Masked()
	}

	return compiledBinding{
		match: Match{
			AssetID:     assetID,
			AssetName:   assetName,
			BindingID:   bindingID,
			MatchType:   matchType,
			MatchValue:  matchValue,
			NetworkType: networkType,
			Priority:    raw.Priority,
		},
		prefix: prefix,
		exact:  exact,
	}, nil
}

func (m *Matcher) MatchIP(rawIP string) (Match, bool) {
	if m == nil {
		return Match{}, false
	}
	addr, err := netip.ParseAddr(strings.TrimSpace(rawIP))
	if err != nil {
		return Match{}, false
	}

	candidates := make([]compiledBinding, 0, 2)
	candidates = append(candidates, m.exact[addr]...)
	for _, binding := range m.prefixes {
		if binding.prefix.Contains(addr) {
			candidates = append(candidates, binding)
		}
	}
	if len(candidates) == 0 {
		return Match{}, false
	}
	sortBindings(candidates)
	return candidates[0].match, true
}

func (m *Matcher) Version() string {
	if m == nil {
		return ""
	}
	return m.version
}

func (m *Matcher) BindingCount() int {
	if m == nil {
		return 0
	}
	count := len(m.prefixes)
	for _, bindings := range m.exact {
		count += len(bindings)
	}
	return count
}

func sortBindings(bindings []compiledBinding) {
	sort.SliceStable(bindings, func(i, j int) bool {
		if bindings[i].match.Priority != bindings[j].match.Priority {
			return bindings[i].match.Priority > bindings[j].match.Priority
		}
		if bindings[i].exact != bindings[j].exact {
			return bindings[i].exact
		}
		leftBits := bindings[i].prefix.Bits()
		rightBits := bindings[j].prefix.Bits()
		if leftBits != rightBits {
			return leftBits > rightBits
		}
		return bindings[i].match.BindingID < bindings[j].match.BindingID
	})
}

func boolPtrValue(value *bool, fallback bool) bool {
	if value == nil {
		return fallback
	}
	return *value
}

type Manager struct {
	path    string
	modTime time.Time
	size    int64
	matcher *Matcher
}

func NewManager(path string) *Manager {
	return &Manager{path: strings.TrimSpace(path), matcher: Disabled()}
}

func (m *Manager) Path() string {
	if m == nil {
		return ""
	}
	return m.path
}

func (m *Manager) Enabled() bool {
	return m != nil && m.path != ""
}

func (m *Manager) Matcher() *Matcher {
	if m == nil || m.matcher == nil {
		return Disabled()
	}
	return m.matcher
}

func (m *Manager) ReloadIfChanged() (bool, error) {
	if m == nil || m.path == "" {
		return false, nil
	}
	stat, err := os.Stat(m.path)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	if m.matcher != nil && stat.ModTime().Equal(m.modTime) && stat.Size() == m.size {
		return false, nil
	}
	next, err := LoadFile(m.path)
	if err != nil {
		return false, err
	}
	m.matcher = next
	m.modTime = stat.ModTime()
	m.size = stat.Size()
	return true, nil
}

func EnrichDocument(document map[string]any, matcher *Matcher, srcIP string, destIP string) {
	if document == nil || matcher == nil {
		return
	}
	asset := map[string]any{}
	if match, ok := matcher.MatchIP(srcIP); ok {
		source := matchDocument(match)
		asset["source"] = source
		setNestedMap(document, []string{"selk"}, "src_asset_id", match.AssetID)
		setNestedMap(document, []string{"selk"}, "src_asset_name", match.AssetName)
		setNestedMap(document, []string{"selk"}, "src_asset_network_type", match.NetworkType)
	}
	if match, ok := matcher.MatchIP(destIP); ok {
		destination := matchDocument(match)
		asset["destination"] = destination
		setNestedMap(document, []string{"selk"}, "dest_asset_id", match.AssetID)
		setNestedMap(document, []string{"selk"}, "dest_asset_name", match.AssetName)
		setNestedMap(document, []string{"selk"}, "dest_asset_network_type", match.NetworkType)
	}
	if len(asset) > 0 {
		asset["version"] = matcher.Version()
		document["asset"] = asset
	}
}

func matchDocument(match Match) map[string]any {
	return map[string]any{
		"asset_id":     match.AssetID,
		"asset_name":   match.AssetName,
		"binding_id":   match.BindingID,
		"match_type":   match.MatchType,
		"match_value":  match.MatchValue,
		"network_type": match.NetworkType,
		"priority":     match.Priority,
	}
}

func setNestedMap(document map[string]any, path []string, key string, value any) {
	current := document
	for _, segment := range path {
		next, ok := current[segment].(map[string]any)
		if !ok {
			next = map[string]any{}
			current[segment] = next
		}
		current = next
	}
	current[key] = value
}

