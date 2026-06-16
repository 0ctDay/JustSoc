package config

import (
	"fmt"
	"log/slog"
	"net/netip"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

const (
	ModeAttach  = "attach"
	ModeManaged = "managed"

	OutputDebug = "debug"
	OutputKafka = "kafka"

	DefaultKafkaTopic = "selk.suricata.eve"
)

type Config struct {
	Probe    ProbeConfig    `yaml:"probe"`
	Suricata SuricataConfig `yaml:"suricata"`
	Kafka    KafkaConfig    `yaml:"kafka"`
	Health   HealthConfig   `yaml:"health"`
	Logging  LoggingConfig  `yaml:"logging"`
}

type ProbeConfig struct {
	SensorID      string            `yaml:"sensor_id"`
	HostOverride  string            `yaml:"host_override"`
	Mode          string            `yaml:"mode"`
	Output        string            `yaml:"output"`
	Interface     string            `yaml:"interface"`
	Interfaces    []string          `yaml:"interfaces,omitempty"`
	StartPosition string            `yaml:"start_position"`
	Tags          map[string]string `yaml:"tags"`
}

type SuricataConfig struct {
	Binary                   string            `yaml:"binary"`
	ConfigPath               string            `yaml:"config_path"`
	RuleDir                  string            `yaml:"rule_dir"`
	EVEPath                  string            `yaml:"eve_path"`
	LogDir                   string            `yaml:"log_dir"`
	Interface                string            `yaml:"interface"`
	Interfaces               []string          `yaml:"interfaces,omitempty"`
	PCAPFile                 string            `yaml:"pcap_file"`
	ExtraArgs                []string          `yaml:"extra_args"`
	Logs                     SuricataLogConfig `yaml:"logs"`
	Whitelist                []WhitelistEntry  `yaml:"whitelist"`
	ManagedCaptureFilterPath string            `yaml:"-"`

	legacyIncludeFlowDNSLogs    bool `yaml:"-"`
	legacyIncludeFlowDNSLogsSet bool `yaml:"-"`
}

type SuricataLogConfig struct {
	DNS  bool             `yaml:"dns"`
	Flow bool             `yaml:"flow"`
	HTTP SuricataHTTPLogs `yaml:"http"`

	dnsSet  bool `yaml:"-"`
	flowSet bool `yaml:"-"`
}

type SuricataHTTPLogs struct {
	Enabled         bool `yaml:"enabled"`
	RequestBody     bool `yaml:"request_body"`
	ResponseBody    bool `yaml:"response_body"`
	BodyLengthLimit int  `yaml:"body_length_limit"`

	enabledSet         bool `yaml:"-"`
	requestBodySet     bool `yaml:"-"`
	responseBodySet    bool `yaml:"-"`
	bodyLengthLimitSet bool `yaml:"-"`
}

type WhitelistEntry struct {
	Protocol string `yaml:"protocol"`
	SrcIP    string `yaml:"src_ip"`
	SrcPort  string `yaml:"src_port"`
	DstIP    string `yaml:"dst_ip"`
	DstPort  string `yaml:"dst_port"`
}

type KafkaConfig struct {
	Brokers      []string      `yaml:"brokers"`
	Topic        string        `yaml:"topic"`
	ClientID     string        `yaml:"client_id"`
	Username     string        `yaml:"username"`
	Password     string        `yaml:"password"`
	BatchBytes   int           `yaml:"batch_bytes"`
	BatchTimeout time.Duration `yaml:"batch_timeout"`
	WriteTimeout time.Duration `yaml:"write_timeout"`
	RequiredAcks int           `yaml:"required_acks"`
}

type HealthConfig struct {
	Enabled    bool   `yaml:"enabled"`
	ListenAddr string `yaml:"listen_addr"`
}

type LoggingConfig struct {
	LevelName string `yaml:"level"`
}

func (c *SuricataConfig) UnmarshalYAML(value *yaml.Node) error {
	type rawSuricataConfig struct {
		Binary                   string            `yaml:"binary"`
		ConfigPath               string            `yaml:"config_path"`
		RuleDir                  string            `yaml:"rule_dir"`
		EVEPath                  string            `yaml:"eve_path"`
		LogDir                   string            `yaml:"log_dir"`
		Interface                string            `yaml:"interface"`
		Interfaces               []string          `yaml:"interfaces"`
		PCAPFile                 string            `yaml:"pcap_file"`
		ExtraArgs                []string          `yaml:"extra_args"`
		Logs                     SuricataLogConfig `yaml:"logs"`
		Whitelist                []WhitelistEntry  `yaml:"whitelist"`
		LegacyIncludeFlowDNSLogs *bool             `yaml:"include_flow_dns_logs"`
	}
	var raw rawSuricataConfig
	if err := value.Decode(&raw); err != nil {
		return err
	}
	c.Binary = raw.Binary
	c.ConfigPath = raw.ConfigPath
	c.RuleDir = raw.RuleDir
	c.EVEPath = raw.EVEPath
	c.LogDir = raw.LogDir
	c.Interface = raw.Interface
	c.Interfaces = normalizeInterfaceList(append(splitInterfaceList(raw.Interface), raw.Interfaces...))
	c.PCAPFile = raw.PCAPFile
	c.ExtraArgs = raw.ExtraArgs
	c.Logs = raw.Logs
	c.Whitelist = raw.Whitelist
	c.legacyIncludeFlowDNSLogsSet = raw.LegacyIncludeFlowDNSLogs != nil
	if raw.LegacyIncludeFlowDNSLogs != nil {
		c.legacyIncludeFlowDNSLogs = *raw.LegacyIncludeFlowDNSLogs
	}
	return nil
}

func (c *SuricataLogConfig) UnmarshalYAML(value *yaml.Node) error {
	type rawSuricataLogConfig struct {
		DNS  *bool            `yaml:"dns"`
		Flow *bool            `yaml:"flow"`
		HTTP SuricataHTTPLogs `yaml:"http"`
	}
	var raw rawSuricataLogConfig
	if err := value.Decode(&raw); err != nil {
		return err
	}
	if raw.DNS != nil {
		c.DNS = *raw.DNS
		c.dnsSet = true
	}
	if raw.Flow != nil {
		c.Flow = *raw.Flow
		c.flowSet = true
	}
	c.HTTP = raw.HTTP
	return nil
}

func (c *SuricataHTTPLogs) UnmarshalYAML(value *yaml.Node) error {
	type rawSuricataHTTPLogs struct {
		Enabled         *bool `yaml:"enabled"`
		RequestBody     *bool `yaml:"request_body"`
		ResponseBody    *bool `yaml:"response_body"`
		BodyLengthLimit *int  `yaml:"body_length_limit"`
	}
	var raw rawSuricataHTTPLogs
	if err := value.Decode(&raw); err != nil {
		return err
	}
	if raw.Enabled != nil {
		c.Enabled = *raw.Enabled
		c.enabledSet = true
	}
	if raw.RequestBody != nil {
		c.RequestBody = *raw.RequestBody
		c.requestBodySet = true
	}
	if raw.ResponseBody != nil {
		c.ResponseBody = *raw.ResponseBody
		c.responseBodySet = true
	}
	if raw.BodyLengthLimit != nil {
		c.BodyLengthLimit = *raw.BodyLengthLimit
		c.bodyLengthLimitSet = true
	}
	return nil
}

func Load(path string) (*Config, error) {
	cfg, err := LoadEditable(path)
	if err != nil {
		return nil, err
	}
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	return cfg, nil
}

func LoadEditable(path string) (*Config, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config %s: %w", path, err)
	}

	content = []byte(os.ExpandEnv(string(content)))

	var cfg Config
	if err := yaml.Unmarshal(content, &cfg); err != nil {
		return nil, fmt.Errorf("parse config %s: %w", path, err)
	}

	cfg.applyDefaults()
	return &cfg, nil
}

func Save(path string, cfg *Config) error {
	content, err := yaml.Marshal(cfg)
	if err != nil {
		return fmt.Errorf("marshal config %s: %w", path, err)
	}
	if err := os.WriteFile(path, content, 0644); err != nil {
		return fmt.Errorf("write config %s: %w", path, err)
	}
	return nil
}

func (c *Config) applyDefaults() {
	if c.Probe.Mode == "" {
		c.Probe.Mode = ModeAttach
	}
	if c.Probe.StartPosition == "" {
		c.Probe.StartPosition = "end"
	}
	if c.Probe.Output == "" {
		c.Probe.Output = OutputKafka
	}
	if c.Kafka.Topic == "" {
		c.Kafka.Topic = DefaultKafkaTopic
	}
	if c.Kafka.ClientID == "" {
		c.Kafka.ClientID = "selk-probe"
	}
	if c.Kafka.BatchBytes == 0 {
		c.Kafka.BatchBytes = 1048576
	}
	if c.Kafka.BatchTimeout == 0 {
		c.Kafka.BatchTimeout = time.Second
	}
	if c.Kafka.WriteTimeout == 0 {
		c.Kafka.WriteTimeout = 10 * time.Second
	}
	if c.Kafka.RequiredAcks == 0 {
		c.Kafka.RequiredAcks = 1
	}
	if c.Health.ListenAddr == "" {
		c.Health.ListenAddr = ":8081"
	}
	if c.Logging.LevelName == "" {
		c.Logging.LevelName = "info"
	}
	if c.Probe.Interface == "" && c.Suricata.Interface != "" {
		c.Probe.Interface = c.Suricata.Interface
	}
	c.Probe.Interfaces = normalizeInterfaceList(append(splitInterfaceList(c.Probe.Interface), c.Probe.Interfaces...))
	c.Suricata.Interfaces = normalizeInterfaceList(append(splitInterfaceList(c.Suricata.Interface), c.Suricata.Interfaces...))
	if c.Probe.Interface == "" && len(c.Probe.Interfaces) > 0 {
		c.Probe.Interface = c.Probe.Interfaces[0]
	}
	if c.Suricata.Interface == "" && len(c.Suricata.Interfaces) > 0 {
		c.Suricata.Interface = c.Suricata.Interfaces[0]
	}
	if len(c.Probe.Interfaces) == 0 && len(c.Suricata.Interfaces) > 0 {
		c.Probe.Interfaces = append([]string(nil), c.Suricata.Interfaces...)
		if c.Probe.Interface == "" {
			c.Probe.Interface = c.Probe.Interfaces[0]
		}
	}
	if len(c.Suricata.Interfaces) == 0 && len(c.Probe.Interfaces) > 0 {
		c.Suricata.Interfaces = append([]string(nil), c.Probe.Interfaces...)
		if c.Suricata.Interface == "" {
			c.Suricata.Interface = c.Suricata.Interfaces[0]
		}
	}
	c.Suricata.normalizeLogs()
	c.Suricata.normalizeWhitelist()
}

func (c *SuricataConfig) normalizeLogs() {
	if c.legacyIncludeFlowDNSLogsSet {
		if !c.Logs.dnsSet {
			c.Logs.DNS = c.legacyIncludeFlowDNSLogs
		}
		if !c.Logs.flowSet {
			c.Logs.Flow = c.legacyIncludeFlowDNSLogs
		}
	}
	if !c.Logs.HTTP.enabledSet {
		c.Logs.HTTP.Enabled = true
	}
	if !c.Logs.HTTP.requestBodySet {
		c.Logs.HTTP.RequestBody = true
	}
	if !c.Logs.HTTP.responseBodySet {
		c.Logs.HTTP.ResponseBody = true
	}
}

func (c *Config) Validate() error {
	return c.ValidateForOutput(c.Probe.Output)
}

func (c *Config) ValidateForOutput(output string) error {
	if c.Suricata.EVEPath == "" {
		return fmt.Errorf("suricata.eve_path is required")
	}
	if c.Probe.Mode != ModeAttach && c.Probe.Mode != ModeManaged {
		return fmt.Errorf("probe.mode must be %q or %q", ModeAttach, ModeManaged)
	}
	if c.Probe.StartPosition != "beginning" && c.Probe.StartPosition != "end" {
		return fmt.Errorf("probe.start_position must be %q or %q", "beginning", "end")
	}
	if err := c.ValidateWhitelist(); err != nil {
		return err
	}
	if err := c.ValidateLogSettings(); err != nil {
		return err
	}
	if output != OutputDebug && output != OutputKafka {
		return fmt.Errorf("probe.output must be %q or %q", OutputDebug, OutputKafka)
	}
	if output == OutputKafka {
		if len(c.Kafka.Brokers) == 0 {
			return fmt.Errorf("kafka.brokers is required when probe.output is %q", OutputKafka)
		}
		if c.Kafka.Topic == "" {
			return fmt.Errorf("kafka.topic is required when probe.output is %q", OutputKafka)
		}
		if (c.Kafka.Username == "") != (c.Kafka.Password == "") {
			return fmt.Errorf("kafka.username and kafka.password must be set together")
		}
	}
	if c.Probe.Mode == ModeManaged {
		if c.Suricata.Binary == "" {
			return fmt.Errorf("suricata.binary is required in managed mode")
		}
		if c.Suricata.ConfigPath == "" {
			return fmt.Errorf("suricata.config_path is required in managed mode")
		}
		if c.Suricata.PCAPFile == "" {
			ifaces := c.CaptureInterfaces()
			if len(ifaces) == 0 || interfaceListHasPlaceholder(ifaces) {
				return fmt.Errorf("managed mode requires a real suricata interface; run 'selk-probe init' or update suricata.interface")
			}
		}
		if len(c.Suricata.Whitelist) > 0 {
			if err := validateManagedCaptureFilterArgs(c.Suricata.ExtraArgs); err != nil {
				return err
			}
		}
	}
	return nil
}

func (c *Config) CaptureInterfaces() []string {
	ifaces := c.Suricata.Interfaces
	if len(ifaces) == 0 {
		ifaces = splitInterfaceList(c.Suricata.Interface)
	}
	if len(ifaces) == 0 {
		ifaces = c.Probe.Interfaces
	}
	if len(ifaces) == 0 {
		ifaces = splitInterfaceList(c.Probe.Interface)
	}
	return normalizeInterfaceList(ifaces)
}

func splitInterfaceList(value string) []string {
	return strings.FieldsFunc(value, func(r rune) bool {
		return r == ',' || r == ';'
	})
}

func normalizeInterfaceList(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	normalized := make([]string, 0, len(values))
	hasRealInterface := false
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		normalized = append(normalized, trimmed)
		if !strings.EqualFold(trimmed, "CHANGE_ME") {
			hasRealInterface = true
		}
	}
	if hasRealInterface {
		filtered := normalized[:0]
		for _, value := range normalized {
			if !strings.EqualFold(value, "CHANGE_ME") {
				filtered = append(filtered, value)
			}
		}
		normalized = filtered
	}
	return normalized
}

func interfaceListHasPlaceholder(values []string) bool {
	for _, value := range values {
		if strings.EqualFold(strings.TrimSpace(value), "CHANGE_ME") {
			return true
		}
	}
	return false
}

func (c *Config) ValidateLogSettings() error {
	if c.Suricata.Logs.HTTP.BodyLengthLimit < 0 {
		return fmt.Errorf("suricata.logs.http.body_length_limit must be >= 0")
	}
	return nil
}

func (c *Config) ValidateWhitelist() error {
	if len(c.Suricata.Whitelist) == 0 {
		return nil
	}
	if c.Probe.Mode != ModeManaged {
		return fmt.Errorf("suricata.whitelist requires probe.mode %q", ModeManaged)
	}
	for i, entry := range c.Suricata.Whitelist {
		if err := validateWhitelistEntry(entry); err != nil {
			return fmt.Errorf("suricata.whitelist[%d]: %w", i, err)
		}
	}
	return nil
}

func (c *SuricataConfig) normalizeWhitelist() {
	for i := range c.Whitelist {
		c.Whitelist[i].Protocol = strings.ToLower(strings.TrimSpace(c.Whitelist[i].Protocol))
		c.Whitelist[i].SrcIP = strings.TrimSpace(c.Whitelist[i].SrcIP)
		c.Whitelist[i].SrcPort = strings.TrimSpace(c.Whitelist[i].SrcPort)
		c.Whitelist[i].DstIP = strings.TrimSpace(c.Whitelist[i].DstIP)
		c.Whitelist[i].DstPort = strings.TrimSpace(c.Whitelist[i].DstPort)
	}
	sort.Slice(c.Whitelist, func(i, j int) bool {
		return whitelistKey(c.Whitelist[i]) < whitelistKey(c.Whitelist[j])
	})
}

func whitelistKey(entry WhitelistEntry) string {
	return strings.Join([]string{entry.Protocol, entry.SrcIP, entry.SrcPort, entry.DstIP, entry.DstPort}, "\x00")
}

func validateWhitelistEntry(entry WhitelistEntry) error {
	if entry.Protocol == "" || entry.SrcIP == "" || entry.SrcPort == "" || entry.DstIP == "" || entry.DstPort == "" {
		return fmt.Errorf("protocol, src_ip, src_port, dst_ip, and dst_port are required")
	}
	if entry.Protocol != "tcp" && entry.Protocol != "udp" {
		return fmt.Errorf("protocol must be tcp or udp")
	}
	if err := validateWhitelistIP(entry.SrcIP); err != nil {
		return fmt.Errorf("src_ip: %w", err)
	}
	if err := validateWhitelistIP(entry.DstIP); err != nil {
		return fmt.Errorf("dst_ip: %w", err)
	}
	if err := validateWhitelistPort(entry.SrcPort); err != nil {
		return fmt.Errorf("src_port: %w", err)
	}
	if err := validateWhitelistPort(entry.DstPort); err != nil {
		return fmt.Errorf("dst_port: %w", err)
	}
	return nil
}

func validateWhitelistIP(value string) error {
	if strings.EqualFold(value, "any") {
		return nil
	}
	if _, err := netip.ParseAddr(value); err == nil {
		return nil
	}
	if _, err := netip.ParsePrefix(value); err == nil {
		return nil
	}
	return fmt.Errorf("must be any, an IP address, or CIDR")
}

func validateWhitelistPort(value string) error {
	if strings.EqualFold(value, "any") {
		return nil
	}
	if strings.Contains(value, "-") {
		parts := strings.SplitN(value, "-", 2)
		if len(parts) != 2 {
			return fmt.Errorf("invalid port range")
		}
		start, err := parsePort(parts[0])
		if err != nil {
			return err
		}
		end, err := parsePort(parts[1])
		if err != nil {
			return err
		}
		if start > end {
			return fmt.Errorf("port range start must be <= end")
		}
		return nil
	}
	_, err := parsePort(value)
	return err
}

func parsePort(value string) (int, error) {
	port, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return 0, fmt.Errorf("must be any, a port, or port range")
	}
	if port < 1 || port > 65535 {
		return 0, fmt.Errorf("must be between 1 and 65535")
	}
	return port, nil
}

func validateManagedCaptureFilterArgs(args []string) error {
	for _, arg := range args {
		trimmed := strings.TrimSpace(arg)
		if trimmed == "-F" || trimmed == "--pcap-filter" || strings.HasPrefix(trimmed, "-F=") || strings.HasPrefix(trimmed, "--pcap-filter=") {
			return fmt.Errorf("suricata.extra_args cannot include %q when suricata.whitelist is set", trimmed)
		}
	}
	return nil
}

func (l LoggingConfig) Level() slog.Level {
	switch strings.ToLower(l.LevelName) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
