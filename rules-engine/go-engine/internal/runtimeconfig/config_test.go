package runtimeconfig

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadAppliesSinkDefaults(t *testing.T) {
	configPath := writeTestConfig(t, `{
  "sink": {
    "mode": "kafka"
  }
}`)

	cfg, _, err := Load(configPath)
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}

	if cfg.Sink.BatchSize != 100 {
		t.Fatalf("BatchSize = %d, want 100", cfg.Sink.BatchSize)
	}
	if cfg.Sink.FlushIntervalMS != 50 {
		t.Fatalf("FlushIntervalMS = %d, want 50", cfg.Sink.FlushIntervalMS)
	}
	if cfg.Sink.QueueSize != 1000 {
		t.Fatalf("QueueSize = %d, want 1000", cfg.Sink.QueueSize)
	}
	if cfg.Sink.Workers != 1 {
		t.Fatalf("Workers = %d, want 1", cfg.Sink.Workers)
	}
}

func TestLoadRejectsUnsupportedSinkWorkers(t *testing.T) {
	configPath := writeTestConfig(t, `{
  "sink": {
    "mode": "kafka",
    "workers": 2
  }
}`)

	_, _, err := Load(configPath)
	if err == nil {
		t.Fatal("Load returned nil error, want unsupported workers error")
	}
	if !strings.Contains(err.Error(), "sink.workers currently only supports 1") {
		t.Fatalf("Load error = %v, want unsupported workers message", err)
	}
}

func TestLoadRejectsNegativeBatchSize(t *testing.T) {
	configPath := writeTestConfig(t, `{
  "sink": {
    "mode": "kafka",
    "batch_size": -1
  }
}`)

	_, _, err := Load(configPath)
	if err == nil {
		t.Fatal("Load returned nil error, want batch size validation error")
	}
	if !strings.Contains(err.Error(), "sink.batch_size") {
		t.Fatalf("Load error = %v, want sink.batch_size message", err)
	}
}

func writeTestConfig(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "engine.conf")
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("write config: %v", err)
	}
	return path
}
