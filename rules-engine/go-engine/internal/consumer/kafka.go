package consumer

import (
	"context"
	"encoding/json"
	"log"
	"os"

	"github.com/segmentio/kafka-go"
	"github.com/segmentio/kafka-go/sasl/plain"

	"justsoc/engine/internal/runtimeconfig"
)

type KafkaReader struct {
	reader *kafka.Reader
	logger *log.Logger
}

func NewKafkaReader(logger *log.Logger, kafkaConfig runtimeconfig.KafkaConfig, topic string, groupID string) *KafkaReader {
	readerConfig := kafka.ReaderConfig{
		Brokers: kafkaConfig.BootstrapServers,
		Topic:   topic,
		GroupID: groupID,
	}
	if kafkaConfig.SecurityProtocol == "SASL_PLAINTEXT" && kafkaConfig.SASL.Mechanism == "PLAIN" {
		readerConfig.Dialer = &kafka.Dialer{
			SASLMechanism: plain.Mechanism{
				Username: kafkaConfig.SASL.Username,
				Password: kafkaConfig.SASL.Password,
			},
		}
	}
	return &KafkaReader{
		reader: kafka.NewReader(readerConfig),
		logger: logger,
	}
}

func NewKafkaReaderFromEnv(logger *log.Logger) *KafkaReader {
	cfg := runtimeconfig.Default()
	cfg.Kafka.BootstrapServers = []string{envOrDefault("SELK_KAFKA_BOOTSTRAP_SERVERS", "127.0.0.1:9092")}
	topic := envOrDefault("SELK_ENGINE_INPUT_TOPIC", "selk.suricata.eve")
	groupID := envOrDefault("SELK_ENGINE_GROUP_ID", "justsoc-threat-engine")
	return NewKafkaReader(logger, cfg.Kafka, topic, groupID)
}

func (r *KafkaReader) Read(ctx context.Context) (map[string]any, error) {
	message, err := r.reader.ReadMessage(ctx)
	if err != nil {
		return nil, err
	}
	var event map[string]any
	if err := json.Unmarshal(message.Value, &event); err != nil {
		return nil, err
	}
	return event, nil
}

func (r *KafkaReader) Close() error {
	return r.reader.Close()
}

func envOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
