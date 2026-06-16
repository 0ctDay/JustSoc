package initcmd

import (
	"bytes"
	"fmt"
	"net/netip"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"justsoc/probe/internal/config"

	"gopkg.in/yaml.v3"
)

const (
	managedSuricataConfigPath = "configs/suricata.generated.yaml"
	ruleDirectoryPath         = "./suricata-rules"
	suricataConfigTemplate    = "configs/suricata.debug.example.yaml"
	suricataYAMLHeader        = "%YAML 1.1\n---\n"
	eveLogRotateInterval      = "20m"
	managedCaptureFilterFile  = "configs/probe-whitelist.generated.bpf"
)

func RegenerateManagedSuricataConfig(baseConfigPath string, logs config.SuricataLogConfig, whitelist []config.WhitelistEntry) (string, string, string, string, error) {
	return generateManagedSuricataConfig(baseConfigPath, logs, whitelist)
}

func ManagedRuleDirectory() (string, error) {
	return filepath.Abs(ruleDirectoryPath)
}

func ManagedCaptureFilterFileName() string {
	return managedCaptureFilterFile
}

func generateManagedSuricataConfig(baseConfigPath string, logs config.SuricataLogConfig, whitelist []config.WhitelistEntry) (string, string, string, string, error) {
	ruleDir, err := filepath.Abs(ruleDirectoryPath)
	if err != nil {
		return "", "", "", "", fmt.Errorf("resolve rule directory: %w", err)
	}

	captureFilterPath, err := writeManagedCaptureFilter(whitelist)
	if err != nil {
		return "", "", "", "", err
	}

	ruleFiles, err := discoverRuleFiles(ruleDir)
	if err != nil {
		return "", "", "", "", err
	}

	templatePath, err := filepath.Abs(suricataConfigTemplate)
	if err != nil {
		return "", "", "", "", fmt.Errorf("resolve Suricata template path: %w", err)
	}

	baseContent, sourcePath, err := readBaseSuricataConfig(baseConfigPath, templatePath)
	if err != nil {
		return "", "", "", "", err
	}

	rendered, err := renderManagedSuricataConfig(baseContent, ruleDir, ruleFiles, logs)
	if err != nil {
		return "", "", "", "", err
	}

	outputPath, err := filepath.Abs(managedSuricataConfigPath)
	if err != nil {
		return "", "", "", "", fmt.Errorf("resolve managed Suricata config path: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(outputPath), 0755); err != nil {
		return "", "", "", "", fmt.Errorf("create managed Suricata config dir: %w", err)
	}
	if err := os.WriteFile(outputPath, []byte(rendered), 0644); err != nil {
		return "", "", "", "", fmt.Errorf("write managed Suricata config %s: %w", outputPath, err)
	}

	return outputPath, sourcePath, captureFilterPath, ruleDir, nil
}

func discoverRuleFiles(ruleDir string) ([]string, error) {
	entries, err := os.ReadDir(ruleDir)
	if err != nil {
		return nil, fmt.Errorf("read rule directory %s: %w", ruleDir, err)
	}

	ruleFiles := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if strings.EqualFold(filepath.Ext(name), ".rules") {
			ruleFiles = append(ruleFiles, name)
		}
	}
	if len(ruleFiles) == 0 {
		return nil, fmt.Errorf("no .rules files found in %s", ruleDir)
	}

	sort.Strings(ruleFiles)
	return ruleFiles, nil
}

func writeManagedCaptureFilter(whitelist []config.WhitelistEntry) (string, error) {
	filterPath, err := filepath.Abs(managedCaptureFilterFile)
	if err != nil {
		return "", fmt.Errorf("resolve managed capture filter path: %w", err)
	}
	content, err := renderManagedCaptureFilter(whitelist)
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(filterPath, []byte(content), 0644); err != nil {
		return "", fmt.Errorf("write managed capture filter %s: %w", filterPath, err)
	}
	return filterPath, nil
}

func renderManagedCaptureFilter(whitelist []config.WhitelistEntry) (string, error) {
	if len(whitelist) == 0 {
		return "greater 0\n", nil
	}

	clauses := make([]string, 0, len(whitelist))
	for _, entry := range whitelist {
		clause, err := renderManagedCaptureFilterClause(entry)
		if err != nil {
			return "", err
		}
		clauses = append(clauses, clause)
	}
	return "not (" + strings.Join(clauses, " or ") + ")\n", nil
}

func renderManagedCaptureFilterClause(entry config.WhitelistEntry) (string, error) {
	parts := []string{entry.Protocol}

	if term, err := renderManagedIPFilter("src", entry.SrcIP); err != nil {
		return "", err
	} else if term != "" {
		parts = append(parts, term)
	}
	if term, err := renderManagedPortFilter("src", entry.SrcPort); err != nil {
		return "", err
	} else if term != "" {
		parts = append(parts, term)
	}
	if term, err := renderManagedIPFilter("dst", entry.DstIP); err != nil {
		return "", err
	} else if term != "" {
		parts = append(parts, term)
	}
	if term, err := renderManagedPortFilter("dst", entry.DstPort); err != nil {
		return "", err
	} else if term != "" {
		parts = append(parts, term)
	}

	return "(" + strings.Join(parts, " and ") + ")", nil
}

func renderManagedIPFilter(direction, value string) (string, error) {
	if strings.EqualFold(value, "any") {
		return "", nil
	}
	if addr, err := netip.ParseAddr(value); err == nil {
		return fmt.Sprintf("%s host %s", direction, addr.String()), nil
	}
	prefix, err := netip.ParsePrefix(value)
	if err != nil {
		return "", fmt.Errorf("render managed capture filter ip %q: %w", value, err)
	}
	return fmt.Sprintf("%s net %s", direction, prefix.Masked().String()), nil
}

func renderManagedPortFilter(direction, value string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if strings.EqualFold(trimmed, "any") {
		return "", nil
	}
	if strings.Contains(trimmed, "-") {
		parts := strings.SplitN(trimmed, "-", 2)
		if len(parts) != 2 {
			return "", fmt.Errorf("render managed capture filter port range %q: invalid range", value)
		}
		start, err := strconv.Atoi(strings.TrimSpace(parts[0]))
		if err != nil {
			return "", fmt.Errorf("render managed capture filter port range %q: %w", value, err)
		}
		end, err := strconv.Atoi(strings.TrimSpace(parts[1]))
		if err != nil {
			return "", fmt.Errorf("render managed capture filter port range %q: %w", value, err)
		}
		return fmt.Sprintf("%s portrange %d-%d", direction, start, end), nil
	}
	port, err := strconv.Atoi(trimmed)
	if err != nil {
		return "", fmt.Errorf("render managed capture filter port %q: %w", value, err)
	}
	return fmt.Sprintf("%s port %d", direction, port), nil
}

func readBaseSuricataConfig(baseConfigPath, fallbackTemplatePath string) (string, string, error) {
	if strings.TrimSpace(baseConfigPath) != "" {
		content, err := os.ReadFile(baseConfigPath)
		if err == nil {
			absPath, pathErr := filepath.Abs(baseConfigPath)
			if pathErr != nil {
				return "", "", fmt.Errorf("resolve base Suricata config path: %w", pathErr)
			}
			return string(content), absPath, nil
		}
		if !os.IsNotExist(err) {
			return "", "", fmt.Errorf("read base Suricata config %s: %w", baseConfigPath, err)
		}
	}

	content, err := os.ReadFile(fallbackTemplatePath)
	if err != nil {
		return "", "", fmt.Errorf("read Suricata config template %s: %w", fallbackTemplatePath, err)
	}
	return string(content), fallbackTemplatePath, nil
}

func renderManagedSuricataConfig(content, ruleDir string, ruleFiles []string, logs config.SuricataLogConfig) (string, error) {
	if len(ruleFiles) == 0 {
		return "", fmt.Errorf("render managed Suricata config: empty rule file list")
	}

	quotedRuleDir := fmt.Sprintf("%q", filepath.Clean(ruleDir))
	content = strings.ReplaceAll(content, "__RULE_DIR__", filepath.Clean(ruleDir))

	defaultRulePathPattern := regexp.MustCompile(`(?m)^default-rule-path:\s*.*$`)
	if defaultRulePathPattern.MatchString(content) {
		content = defaultRulePathPattern.ReplaceAllString(content, "default-rule-path: "+quotedRuleDir)
	} else {
		content = strings.TrimRight(content, "\r\n") + "\n\ndefault-rule-path: " + quotedRuleDir + "\n"
	}

	var ruleBlock strings.Builder
	ruleBlock.WriteString("rule-files:\n")
	for _, ruleFile := range ruleFiles {
		ruleBlock.WriteString("  - ")
		ruleBlock.WriteString(ruleFile)
		ruleBlock.WriteString("\n")
	}

	ruleFilesPattern := regexp.MustCompile(`(?ms)^rule-files:\s*\r?\n(?:\s*-\s+.+\r?\n)+`)
	if ruleFilesPattern.MatchString(content) {
		content = ruleFilesPattern.ReplaceAllString(content, ruleBlock.String())
	} else {
		content = strings.TrimRight(content, "\r\n") + "\n\n" + ruleBlock.String()
	}

	content, err := normalizeSuricataOutputs(content, logs)
	if err != nil {
		return "", err
	}

	return content, nil
}

func normalizeSuricataOutputs(content string, logs config.SuricataLogConfig) (string, error) {
	var document yaml.Node
	if err := yaml.Unmarshal([]byte(content), &document); err != nil {
		return "", fmt.Errorf("parse managed Suricata config: %w", err)
	}
	if len(document.Content) == 0 {
		return "", fmt.Errorf("parse managed Suricata config: empty document")
	}

	root := document.Content[0]
	if root.Kind != yaml.MappingNode {
		return "", fmt.Errorf("parse managed Suricata config: expected mapping root")
	}

	outputs := mappingValue(root, "outputs")
	if outputs == nil {
		setMappingValue(root, "outputs", &yaml.Node{
			Kind: yaml.SequenceNode,
			Tag:  "!!seq",
			Content: []*yaml.Node{
				newEveLogOutputNode(logs),
			},
		})
	} else {
		if outputs.Kind != yaml.SequenceNode {
			return "", fmt.Errorf("parse managed Suricata config: outputs must be a sequence")
		}

		found := false
		for _, output := range outputs.Content {
			if output.Kind != yaml.MappingNode {
				continue
			}
			eveLog := mappingValue(output, "eve-log")
			if eveLog == nil {
				continue
			}
			if eveLog.Kind != yaml.MappingNode {
				return "", fmt.Errorf("parse managed Suricata config: eve-log must be a mapping")
			}
			setMappingValue(eveLog, "rotate-interval", newStringNode(eveLogRotateInterval))
			setMappingValue(eveLog, "types", newEveLogTypesNode(logs))
			found = true
		}
		if !found {
			outputs.Content = append(outputs.Content, newEveLogOutputNode(logs))
		}
	}

	normalizeLibHTPConfig(root, logs.HTTP)

	var rendered bytes.Buffer
	encoder := yaml.NewEncoder(&rendered)
	encoder.SetIndent(2)
	if err := encoder.Encode(&document); err != nil {
		return "", fmt.Errorf("encode managed Suricata config: %w", err)
	}
	if err := encoder.Close(); err != nil {
		return "", fmt.Errorf("close managed Suricata config encoder: %w", err)
	}

	return suricataYAMLHeader + rendered.String(), nil
}

func normalizeLibHTPConfig(root *yaml.Node, httpLogs config.SuricataHTTPLogs) {
	libhtp := ensureMappingValue(root, "libhtp")
	defaultConfig := ensureMappingValue(libhtp, "default-config")

	if httpLogs.RequestBody {
		setMappingValue(defaultConfig, "request-body-limit", newIntNode(httpLogs.BodyLengthLimit))
	} else {
		deleteMappingValue(defaultConfig, "request-body-limit")
	}

	if httpLogs.ResponseBody {
		setMappingValue(defaultConfig, "response-body-limit", newIntNode(httpLogs.BodyLengthLimit))
	} else {
		deleteMappingValue(defaultConfig, "response-body-limit")
	}

	if len(defaultConfig.Content) == 0 {
		deleteMappingValue(libhtp, "default-config")
	}
	if len(libhtp.Content) == 0 {
		deleteMappingValue(root, "libhtp")
	}
}

func mappingValue(node *yaml.Node, key string) *yaml.Node {
	if node == nil || node.Kind != yaml.MappingNode {
		return nil
	}
	for i := 0; i+1 < len(node.Content); i += 2 {
		if node.Content[i].Value == key {
			return node.Content[i+1]
		}
	}
	return nil
}

func setMappingValue(node *yaml.Node, key string, value *yaml.Node) {
	for i := 0; i+1 < len(node.Content); i += 2 {
		if node.Content[i].Value == key {
			node.Content[i+1] = value
			return
		}
	}
	keyNode := &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: key}
	node.Content = append(node.Content, keyNode, value)
}

func ensureMappingValue(node *yaml.Node, key string) *yaml.Node {
	if existing := mappingValue(node, key); existing != nil {
		return existing
	}
	created := &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map"}
	setMappingValue(node, key, created)
	return created
}

func deleteMappingValue(node *yaml.Node, key string) {
	if node == nil || node.Kind != yaml.MappingNode {
		return
	}
	for i := 0; i+1 < len(node.Content); i += 2 {
		if node.Content[i].Value == key {
			node.Content = append(node.Content[:i], node.Content[i+2:]...)
			return
		}
	}
}

func newEveLogOutputNode(logs config.SuricataLogConfig) *yaml.Node {
	return &yaml.Node{
		Kind: yaml.MappingNode,
		Tag:  "!!map",
		Content: []*yaml.Node{
			{Kind: yaml.ScalarNode, Tag: "!!str", Value: "eve-log"},
			{
				Kind: yaml.MappingNode,
				Tag:  "!!map",
				Content: []*yaml.Node{
					{Kind: yaml.ScalarNode, Tag: "!!str", Value: "enabled"},
					{Kind: yaml.ScalarNode, Tag: "!!str", Value: "yes"},
					{Kind: yaml.ScalarNode, Tag: "!!str", Value: "filetype"},
					{Kind: yaml.ScalarNode, Tag: "!!str", Value: "regular"},
					{Kind: yaml.ScalarNode, Tag: "!!str", Value: "filename"},
					{Kind: yaml.ScalarNode, Tag: "!!str", Value: "eve.json"},
					{Kind: yaml.ScalarNode, Tag: "!!str", Value: "rotate-interval"},
					newStringNode(eveLogRotateInterval),
					{Kind: yaml.ScalarNode, Tag: "!!str", Value: "types"},
					newEveLogTypesNode(logs),
				},
			},
		},
	}
}

func newStringNode(value string) *yaml.Node {
	return &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: value}
}

func newIntNode(value int) *yaml.Node {
	return &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!int", Value: strconv.Itoa(value)}
}

func newEveLogTypesNode(logs config.SuricataLogConfig) *yaml.Node {
	types := []*yaml.Node{
		newAlertTypeNode(logs.HTTP),
	}
	if logs.HTTP.Enabled {
		types = append(types, newHTTPTypeNode())
	}
	if logs.DNS {
		types = append(types, newStringNode("dns"))
	}
	if logs.Flow {
		types = append(types, newStringNode("flow"))
	}
	return &yaml.Node{
		Kind:    yaml.SequenceNode,
		Tag:     "!!seq",
		Content: types,
	}
}

func newAlertTypeNode(httpLogs config.SuricataHTTPLogs) *yaml.Node {
	httpBodyEnabled := httpLogs.RequestBody || httpLogs.ResponseBody
	httpBodyValue := "no"
	if httpBodyEnabled {
		httpBodyValue = "yes"
	}
	return &yaml.Node{
		Kind: yaml.MappingNode,
		Tag:  "!!map",
		Content: []*yaml.Node{
			{Kind: yaml.ScalarNode, Tag: "!!str", Value: "alert"},
			{
				Kind: yaml.MappingNode,
				Tag:  "!!map",
				Content: []*yaml.Node{
					{Kind: yaml.ScalarNode, Tag: "!!str", Value: "packet"},
					{Kind: yaml.ScalarNode, Tag: "!!str", Value: "yes"},
					{Kind: yaml.ScalarNode, Tag: "!!str", Value: "payload"},
					{Kind: yaml.ScalarNode, Tag: "!!str", Value: "yes"},
					{Kind: yaml.ScalarNode, Tag: "!!str", Value: "payload-printable"},
					{Kind: yaml.ScalarNode, Tag: "!!str", Value: "yes"},
					{Kind: yaml.ScalarNode, Tag: "!!str", Value: "payload-length"},
					{Kind: yaml.ScalarNode, Tag: "!!str", Value: "yes"},
					{Kind: yaml.ScalarNode, Tag: "!!str", Value: "metadata"},
					newAlertMetadataNode(),
					{Kind: yaml.ScalarNode, Tag: "!!str", Value: "http-body"},
					{Kind: yaml.ScalarNode, Tag: "!!str", Value: httpBodyValue},
					{Kind: yaml.ScalarNode, Tag: "!!str", Value: "http-body-printable"},
					{Kind: yaml.ScalarNode, Tag: "!!str", Value: httpBodyValue},
				},
			},
		},
	}
}

func newAlertMetadataNode() *yaml.Node {
	return &yaml.Node{
		Kind: yaml.MappingNode,
		Tag:  "!!map",
		Content: []*yaml.Node{
			{Kind: yaml.ScalarNode, Tag: "!!str", Value: "app-layer"},
			{Kind: yaml.ScalarNode, Tag: "!!bool", Value: "true"},
		},
	}
}

func newHTTPTypeNode() *yaml.Node {
	return &yaml.Node{
		Kind: yaml.MappingNode,
		Tag:  "!!map",
		Content: []*yaml.Node{
			{Kind: yaml.ScalarNode, Tag: "!!str", Value: "http"},
			{
				Kind: yaml.MappingNode,
				Tag:  "!!map",
				Content: []*yaml.Node{
					{Kind: yaml.ScalarNode, Tag: "!!str", Value: "extended"},
					{Kind: yaml.ScalarNode, Tag: "!!str", Value: "yes"},
					{Kind: yaml.ScalarNode, Tag: "!!str", Value: "dump-all-headers"},
					{Kind: yaml.ScalarNode, Tag: "!!str", Value: "both"},
				},
			},
		},
	}
}

