package runtimeconfig

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type Config struct {
	Debug     bool            `json:"debug"`
	Kafka     KafkaConfig     `json:"kafka"`
	Consumer  ConsumerConfig  `json:"consumer"`
	Sink      SinkConfig      `json:"sink"`
	Whitelist WhitelistConfig `json:"whitelist"`
	Rules     RulesConfig     `json:"rules"`
	Assets    AssetConfig     `json:"assets"`
}

type KafkaConfig struct {
	BootstrapServers []string        `json:"bootstrap_servers"`
	SecurityProtocol string          `json:"security_protocol"`
	SASL             KafkaSASLConfig `json:"sasl"`
}

type KafkaSASLConfig struct {
	Mechanism string `json:"mechanism"`
	Username  string `json:"username"`
	Password  string `json:"password"`
}

type ConsumerConfig struct {
	Topic   string `json:"topic"`
	GroupID string `json:"group_id"`
}

type SinkConfig struct {
	Mode            string          `json:"mode"`
	BatchSize       int             `json:"batch_size"`
	FlushIntervalMS int             `json:"flush_interval_ms"`
	QueueSize       int             `json:"queue_size"`
	Workers         int             `json:"workers"`
	Kafka           SinkKafkaConfig `json:"kafka"`
	ES              SinkESConfig    `json:"es"`
}

type SinkKafkaConfig struct {
	Topic string `json:"topic"`
}

type SinkESConfig struct {
	Endpoint string `json:"endpoint"`
	Index    string `json:"index"`
}

type WhitelistConfig struct {
	Path string `json:"path"`
}

type RulesConfig struct {
	Path        string `json:"path"`
	SuricataDir string `json:"suricata_dir"`
}

type AssetConfig struct {
	Path string `json:"path"`
}

func Default() Config {
	return Config{
		Debug: false,
		Kafka: KafkaConfig{
			BootstrapServers: []string{"127.0.0.1:9092"},
			SecurityProtocol: "",
			SASL:             KafkaSASLConfig{},
		},
		Consumer: ConsumerConfig{
			Topic:   "selk.suricata.eve",
			GroupID: "justsoc-threat-engine",
		},
		Sink: SinkConfig{
			Mode:            "kafka",
			BatchSize:       100,
			FlushIntervalMS: 50,
			QueueSize:       1000,
			Workers:         1,
			Kafka:           SinkKafkaConfig{Topic: "selk.alerts.enriched"},
			ES: SinkESConfig{
				Endpoint: "http://127.0.0.1:9200",
				Index:    "selk-alerts-write",
			},
		},
	}
}

func Load(path string) (Config, string, error) {
	cfg := Default()
	if strings.TrimSpace(path) == "" {
		return cfg, "", fmt.Errorf("config path is empty")
	}
	absolutePath, err := filepath.Abs(path)
	if err != nil {
		return cfg, "", err
	}
	payload, err := os.ReadFile(absolutePath)
	if err != nil {
		return cfg, absolutePath, err
	}
	if err := json.Unmarshal(payload, &cfg); err != nil {
		return cfg, absolutePath, fmt.Errorf("parse config: %w", err)
	}
	normalize(&cfg, filepath.Dir(absolutePath))
	if err := validate(cfg); err != nil {
		return cfg, absolutePath, err
	}
	return cfg, absolutePath, nil
}

func normalize(cfg *Config, baseDir string) {
	defaults := Default()
	if len(cfg.Kafka.BootstrapServers) == 0 {
		cfg.Kafka.BootstrapServers = defaults.Kafka.BootstrapServers
	}
	cfg.Kafka.BootstrapServers = cleanStrings(cfg.Kafka.BootstrapServers)
	if len(cfg.Kafka.BootstrapServers) == 0 {
		cfg.Kafka.BootstrapServers = defaults.Kafka.BootstrapServers
	}
	cfg.Kafka.SecurityProtocol = strings.ToUpper(strings.TrimSpace(cfg.Kafka.SecurityProtocol))
	cfg.Kafka.SASL.Mechanism = strings.ToUpper(strings.TrimSpace(cfg.Kafka.SASL.Mechanism))
	cfg.Kafka.SASL.Username = strings.TrimSpace(cfg.Kafka.SASL.Username)
	cfg.Kafka.SASL.Password = strings.TrimSpace(cfg.Kafka.SASL.Password)

	cfg.Consumer.Topic = firstNonEmpty(cfg.Consumer.Topic, defaults.Consumer.Topic)
	cfg.Consumer.GroupID = firstNonEmpty(cfg.Consumer.GroupID, defaults.Consumer.GroupID)

	cfg.Sink.Mode = strings.ToLower(strings.TrimSpace(firstNonEmpty(cfg.Sink.Mode, defaults.Sink.Mode)))
	cfg.Sink.BatchSize = defaultPositiveInt(cfg.Sink.BatchSize, defaults.Sink.BatchSize)
	cfg.Sink.FlushIntervalMS = defaultPositiveInt(cfg.Sink.FlushIntervalMS, defaults.Sink.FlushIntervalMS)
	cfg.Sink.QueueSize = defaultPositiveInt(cfg.Sink.QueueSize, defaults.Sink.QueueSize)
	cfg.Sink.Workers = defaultPositiveInt(cfg.Sink.Workers, defaults.Sink.Workers)
	cfg.Sink.Kafka.Topic = firstNonEmpty(cfg.Sink.Kafka.Topic, defaults.Sink.Kafka.Topic)
	cfg.Sink.ES.Endpoint = firstNonEmpty(cfg.Sink.ES.Endpoint, defaults.Sink.ES.Endpoint)
	cfg.Sink.ES.Index = firstNonEmpty(cfg.Sink.ES.Index, defaults.Sink.ES.Index)

	cfg.Whitelist.Path = strings.TrimSpace(cfg.Whitelist.Path)
	if cfg.Whitelist.Path != "" && !filepath.IsAbs(cfg.Whitelist.Path) {
		cfg.Whitelist.Path = filepath.Clean(filepath.Join(baseDir, cfg.Whitelist.Path))
	}
	cfg.Rules.Path = strings.TrimSpace(cfg.Rules.Path)
	if cfg.Rules.Path != "" && !filepath.IsAbs(cfg.Rules.Path) {
		cfg.Rules.Path = filepath.Clean(filepath.Join(baseDir, cfg.Rules.Path))
	}
	cfg.Rules.SuricataDir = strings.TrimSpace(cfg.Rules.SuricataDir)
	if cfg.Rules.SuricataDir != "" && !filepath.IsAbs(cfg.Rules.SuricataDir) {
		cfg.Rules.SuricataDir = filepath.Clean(filepath.Join(baseDir, cfg.Rules.SuricataDir))
	}

	cfg.Assets.Path = strings.TrimSpace(firstNonEmpty(cfg.Assets.Path, assetPathFromEnv()))
	if cfg.Assets.Path != "" && !filepath.IsAbs(cfg.Assets.Path) {
		cfg.Assets.Path = filepath.Clean(filepath.Join(baseDir, cfg.Assets.Path))
	}
}

func validate(cfg Config) error {
	switch cfg.Sink.Mode {
	case "kafka", "es", "elasticsearch":
	default:
		return fmt.Errorf("unsupported output mode %q", cfg.Sink.Mode)
	}
	if len(cfg.Kafka.BootstrapServers) == 0 {
		return fmt.Errorf("kafka.bootstrap_servers is empty")
	}
	if cfg.Kafka.SecurityProtocol != "" && cfg.Kafka.SecurityProtocol != "SASL_PLAINTEXT" {
		return fmt.Errorf("unsupported kafka.security_protocol %q", cfg.Kafka.SecurityProtocol)
	}
	if cfg.Kafka.SecurityProtocol == "SASL_PLAINTEXT" {
		if cfg.Kafka.SASL.Mechanism != "PLAIN" {
			return fmt.Errorf("unsupported kafka.sasl.mechanism %q", cfg.Kafka.SASL.Mechanism)
		}
		if cfg.Kafka.SASL.Username == "" || cfg.Kafka.SASL.Password == "" {
			return fmt.Errorf("kafka.sasl.username or kafka.sasl.password is empty")
		}
	}
	if cfg.Sink.BatchSize <= 0 {
		return fmt.Errorf("sink.batch_size must be greater than 0")
	}
	if cfg.Sink.FlushIntervalMS <= 0 {
		return fmt.Errorf("sink.flush_interval_ms must be greater than 0")
	}
	if cfg.Sink.QueueSize <= 0 {
		return fmt.Errorf("sink.queue_size must be greater than 0")
	}
	if cfg.Sink.Workers <= 0 {
		return fmt.Errorf("sink.workers must be greater than 0")
	}
	if cfg.Sink.Workers != 1 {
		return fmt.Errorf("sink.workers currently only supports 1")
	}
	return nil
}

func cleanStrings(values []string) []string {
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

func firstNonEmpty(value, fallback string) string {
	value = strings.TrimSpace(value)
	if value != "" {
		return value
	}
	return fallback
}

func defaultPositiveInt(value, fallback int) int {
	if value == 0 {
		return fallback
	}
	return value
}

func assetPathFromEnv() string {
	if path := strings.TrimSpace(os.Getenv("SELK_ASSET_CONFIG_PATH")); path != "" {
		return path
	}
	root := strings.TrimSpace(os.Getenv("SELK_ASSET_CONFIG_ROOT"))
	if root == "" {
		return ""
	}
	return filepath.Join(root, "current", "assets.yaml")
}

