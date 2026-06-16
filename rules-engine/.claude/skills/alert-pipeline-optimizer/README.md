# Alert Pipeline Optimizer Reference

This skill serves the SELK alert-processing chain after traffic has already entered the detection pipeline.

## Main ownership layers

1. `probe/internal/pipeline/correlator.go`
   - Attaches `correlated_http` to alerts
   - Owns flow/transaction correlation and TTL release behavior

2. `go-engine/internal/evaluate/evaluator.go`
   - Owns rule matching, success hints, behavior detection, attack-stage logic, and some alert-shaped enrichment

3. `go-engine/internal/sink/*`
   - Owns final output shaping for writers, especially Elasticsearch-friendly fields

## What this skill is for

- Alert correlation quality problems
- Success judgment problems
- Behavior-to-alert shaping problems
- ES-facing output structure problems

## What this skill is not for

- Adding new Suricata rules
- Adding new YAML engine rules
- Deployment changes
- Kafka topology changes
- Logstash routing changes

If the request is really about adding a new detection rule, use the `rule-library-writer` skill instead.

## Default workflow

- Step 1: classify the alert problem
- Step 2: locate the owning layer
- Step 3: identify the smallest logic change
- Step 4: explain risks and verification
- Step 5: wait for explicit implementation approval
