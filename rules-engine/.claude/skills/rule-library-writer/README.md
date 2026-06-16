# Rule Library Writer Reference

This skill serves the SELK repository’s detection chain.

## Detection layers

1. `probe/suricata-rules/*.rules`
   - First-pass traffic signatures
   - Best for stable, directly matchable exploit traits in HTTP or other protocol data

2. `go-engine/configs/engine-rules.yaml`
   - Second-pass flexible content matching and enrichment
   - Best for combined token logic across `payload_printable`, `http_url`, and correlated context

## Event flow

1. Suricata produces EVE events
2. `probe/internal/pipeline/correlator.go` may attach `correlated_http` to alerts
3. Probe publishes events downstream
4. `go-engine/cmd/threat-engine/main.go` loads YAML rules and evaluates events
5. Evaluator adds enrichment and sinks write the final output

## Repositories and files to inspect first

- `probe/suricata-rules/web-*.rules`
- `go-engine/configs/engine-rules.yaml`
- `go-engine/internal/rules/loader.go`
- `go-engine/internal/evaluate/highlight_rules.go`
- `probe/internal/pipeline/correlator.go`
- `go-engine/cmd/threat-engine/main.go`

## Default workflow

- Step 1: classify the packet key points
- Step 2: decide rule placement
- Step 3: find the nearest existing rule family
- Step 4: draft the smallest useful change
- Step 5: wait for explicit implementation approval
