package kafka

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"strconv"
	"time"

	"justsoc/probe/internal/config"
	"justsoc/probe/internal/eve"

	kafkaapi "github.com/segmentio/kafka-go"
	"github.com/segmentio/kafka-go/sasl"
	"github.com/segmentio/kafka-go/sasl/plain"
)

type Producer struct {
	writer *kafkaapi.Writer
	logger *slog.Logger
	topic  string
}

func NewProducer(cfg config.KafkaConfig, logger *slog.Logger) (*Producer, error) {
	topic := cfg.Topic
	if topic == "" {
		topic = config.DefaultKafkaTopic
	}

	mechanism := saslMechanism(cfg)

	if err := ensureTopic(cfg, topic, mechanism); err != nil {
		return nil, err
	}

	writer := &kafkaapi.Writer{
		Addr:         kafkaapi.TCP(cfg.Brokers...),
		Topic:        topic,
		Balancer:     &kafkaapi.LeastBytes{},
		BatchBytes:   int64(cfg.BatchBytes),
		BatchTimeout: cfg.BatchTimeout,
		WriteTimeout: cfg.WriteTimeout,
		RequiredAcks: kafkaapi.RequiredAcks(cfg.RequiredAcks),
		Async:        false,
		Transport: &kafkaapi.Transport{
			ClientID: cfg.ClientID,
			SASL:     mechanism,
		},
	}

	return &Producer{writer: writer, logger: logger, topic: topic}, nil
}

func ensureTopic(cfg config.KafkaConfig, topic string, mechanism sasl.Mechanism) error {
	ctx, cancel := context.WithTimeout(context.Background(), cfg.WriteTimeout)
	defer cancel()

	dialer := &kafkaapi.Dialer{
		Timeout:       cfg.WriteTimeout,
		ClientID:      cfg.ClientID,
		SASLMechanism: mechanism,
	}

	conn, err := dialer.DialContext(ctx, "tcp", cfg.Brokers[0])
	if err != nil {
		return fmt.Errorf("dial kafka broker %s: %w", cfg.Brokers[0], err)
	}
	defer conn.Close()

	controller, err := conn.Controller()
	if err != nil {
		return fmt.Errorf("lookup kafka controller: %w", err)
	}

	controllerAddr := net.JoinHostPort(controller.Host, strconv.Itoa(controller.Port))
	controllerConn, err := dialer.DialContext(ctx, "tcp", controllerAddr)
	if err != nil {
		return fmt.Errorf("dial kafka controller %s: %w", controllerAddr, err)
	}
	defer controllerConn.Close()

	if err := controllerConn.CreateTopics(kafkaapi.TopicConfig{
		Topic:             topic,
		NumPartitions:     1,
		ReplicationFactor: 1,
	}); err != nil {
		return fmt.Errorf("create kafka topic %s: %w", topic, err)
	}

	return nil
}

func (p *Producer) PublishBatch(ctx context.Context, events []eve.Event) error {
	if len(events) == 0 {
		return nil
	}

	messages := make([]kafkaapi.Message, 0, len(events))
	for _, event := range events {
		payload, err := json.Marshal(event)
		if err != nil {
			return fmt.Errorf("marshal event: %w", err)
		}

		messages = append(messages, kafkaapi.Message{
			Time:  time.Now().UTC(),
			Value: payload,
			Headers: []kafkaapi.Header{
				{Key: "event_type", Value: []byte(stringValue(event["event_type"]))},
				{Key: "sensor_id", Value: []byte(stringValue(event["sensor_id"]))},
			},
		})
	}

	if err := p.writer.WriteMessages(ctx, messages...); err != nil {
		return fmt.Errorf("publish to topic %s: %w", p.topic, err)
	}

	return nil
}

func (p *Producer) Close() error {
	return p.writer.Close()
}

func saslMechanism(cfg config.KafkaConfig) sasl.Mechanism {
	if cfg.Username == "" && cfg.Password == "" {
		return nil
	}
	return plain.Mechanism{Username: cfg.Username, Password: cfg.Password}
}

func stringValue(value any) string {
	if value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return text
	}
	return fmt.Sprint(value)
}
