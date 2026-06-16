package pipeline

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"justsoc/probe/internal/eve"
)

type DebugSink struct{}

func NewDebugSink() *DebugSink {
	return &DebugSink{}
}

func (s *DebugSink) PublishBatch(_ context.Context, events []eve.Event) error {
	for _, event := range events {
		payload, err := json.Marshal(event)
		if err != nil {
			return fmt.Errorf("marshal debug event: %w", err)
		}
		if _, err := fmt.Fprintln(os.Stdout, string(payload)); err != nil {
			return fmt.Errorf("write debug event: %w", err)
		}
	}
	return nil
}
