# Optimization Map

## Symptom -> likely owner

### `correlated_http` missing or wrong
- Primary owner: `probe/internal/pipeline/correlator.go`
- Also inspect: `probe/internal/pipeline/correlator_test.go`

### `attack_success` or `attack_stage` feels wrong
- Primary owner: `go-engine/internal/evaluate/evaluator.go`
- Also inspect: related evaluator tests

### Alert should look more like a native alert document
- Primary owner: `go-engine/internal/evaluate/evaluator.go`
- Secondary owner: `go-engine/internal/sink/es.go`

### `source` / `destination` / `rule.*` / `event.severity` wrong in ES
- Primary owner: `go-engine/internal/sink/es.go`
- Also inspect: `go-engine/internal/sink/es_test.go`

### Problem spans multiple layers
- Only classify as cross-layer when there is evidence that correlation, enrichment, and output shaping all contribute

## Scope guard

Use this skill for logic-layer alert optimization only.

Escalate or stop before editing if the request actually requires:

- `probe` or `go-engine` runtime config changes
- Logstash changes
- Kafka producer or consumer topology changes
- New rule-library additions
