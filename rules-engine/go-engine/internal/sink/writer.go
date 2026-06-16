package sink

import (
	"context"
	"fmt"
	"log"
	"strings"

	"justsoc/engine/internal/runtimeconfig"
)

type Writer interface {
	Write(ctx context.Context, event map[string]any) error
	Close() error
}

func NewWriter(logger *log.Logger, cfg runtimeconfig.Config) (Writer, string, error) {
	mode := strings.ToLower(strings.TrimSpace(cfg.Sink.Mode))
	switch mode {
	case "kafka":
		return NewKafkaWriter(logger, cfg.Kafka, cfg.Sink.Kafka.Topic), "kafka", nil
	case "es", "elasticsearch":
		return NewESWriter(cfg.Sink.ES.Endpoint, cfg.Sink.ES.Index), "es", nil
	default:
		return nil, "", fmt.Errorf("unsupported sink mode %q", cfg.Sink.Mode)
	}
}
