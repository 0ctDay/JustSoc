package sink

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"time"

	"github.com/segmentio/kafka-go"
	"github.com/segmentio/kafka-go/sasl/plain"

	"justsoc/engine/internal/runtimeconfig"
)

type KafkaWriter struct {
	writer *kafka.Writer
	logger *log.Logger
}

func NewKafkaWriter(logger *log.Logger, kafkaConfig runtimeconfig.KafkaConfig, topic string) *KafkaWriter {
	writer := &kafka.Writer{
		Addr:         kafka.TCP(kafkaConfig.BootstrapServers...),
		Topic:        topic,
		BatchSize:    100,
		BatchTimeout: 50 * time.Millisecond,
	}
	if kafkaConfig.SecurityProtocol == "SASL_PLAINTEXT" && kafkaConfig.SASL.Mechanism == "PLAIN" {
		writer.Transport = &kafka.Transport{
			SASL: plain.Mechanism{
				Username: kafkaConfig.SASL.Username,
				Password: kafkaConfig.SASL.Password,
			},
		}
	}
	return &KafkaWriter{writer: writer, logger: logger}
}

func NewKafkaWriterFromEnv(logger *log.Logger) *KafkaWriter {
	cfg := runtimeconfig.Default()
	cfg.Kafka.BootstrapServers = []string{envOrDefault("SELK_KAFKA_BOOTSTRAP_SERVERS", "127.0.0.1:9092")}
	topic := envOrDefault("SELK_ENGINE_OUTPUT_TOPIC", "selk.alerts.enriched")
	return NewKafkaWriter(logger, cfg.Kafka, topic)
}

func (w *KafkaWriter) Write(ctx context.Context, event map[string]any) error {
	return w.WriteBatch(ctx, []map[string]any{event})
}

func (w *KafkaWriter) WriteBatch(ctx context.Context, events []map[string]any) error {
	if len(events) == 0 {
		return nil
	}

	messages := make([]kafka.Message, 0, len(events))
	for _, event := range events {
		payload, err := json.Marshal(event)
		if err != nil {
			return err
		}
		messages = append(messages, kafka.Message{Value: payload})
	}
	return w.writer.WriteMessages(ctx, messages...)
}

func (w *KafkaWriter) Close() error {
	return w.writer.Close()
}

func envOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
