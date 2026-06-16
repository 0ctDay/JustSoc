package enrich

import (
	"strings"
	"time"

	"justsoc/probe/internal/config"
	"justsoc/probe/internal/eve"
)

type Enricher struct {
	sensorID string
	host     string
	mode     string
	iface    string
	tags     map[string]string
}

func New(cfg config.ProbeConfig, detectedHost string) *Enricher {
	host := detectedHost
	if cfg.HostOverride != "" {
		host = cfg.HostOverride
	}

	return &Enricher{
		sensorID: cfg.SensorID,
		host:     host,
		mode:     cfg.Mode,
		iface:    probeInterfaceText(cfg),
		tags:     cfg.Tags,
	}
}

func probeInterfaceText(cfg config.ProbeConfig) string {
	if len(cfg.Interfaces) == 0 {
		return cfg.Interface
	}
	return strings.Join(cfg.Interfaces, ",")
}

func (e *Enricher) Apply(event eve.Event) eve.Event {
	if event == nil {
		event = eve.Event{}
	}

	if e.sensorID != "" {
		event["sensor_id"] = e.sensorID
	}
	event["ingested_at"] = time.Now().UTC().Format(time.RFC3339Nano)
	event["probe"] = map[string]any{
		"host":  e.host,
		"mode":  e.mode,
		"iface": e.iface,
		"tags":  cloneTags(e.tags),
	}

	return event
}

func cloneTags(tags map[string]string) map[string]any {
	if len(tags) == 0 {
		return map[string]any{}
	}

	cloned := make(map[string]any, len(tags))
	for k, v := range tags {
		cloned[k] = v
	}
	return cloned
}
