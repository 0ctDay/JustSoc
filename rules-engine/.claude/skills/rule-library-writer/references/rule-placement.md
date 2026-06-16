# Rule Placement Guide

## Put it in Suricata when

Use `probe/suricata-rules/*.rules` when the indicator is stable and directly visible in traffic:

- exploit path is fixed
- HTTP method and URI pattern are distinctive
- header or cookie marker is deterministic
- body contains a reliable static token
- protocol field match is straightforward

## Put it in go-engine when

Use `go-engine/configs/engine-rules.yaml` when the indicator needs flexible logic:

- multiple weak tokens need to be combined
- matching should span `payload_printable` and `http_url`
- normalization matters more than protocol-level matching
- the logic benefits from alert-correlated HTTP context
- the change is mainly for enrichment or second-pass detection

## Put it in both when

Use both layers when you want:

- fast raw traffic alerting in Suricata
- stronger classification, highlighting, or fallback matching in go-engine

## Always check first

- Is there already a matching `web-*.rules` file?
- Is there already a related YAML engine rule?
- Can you extend an existing rule family instead of adding a new one?
- Will the new tokens affect highlighting expectations?
