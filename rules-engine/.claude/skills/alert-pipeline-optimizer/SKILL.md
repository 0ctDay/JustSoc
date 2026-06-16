---
name: alert-pipeline-optimizer
description: Use this skill when the user wants to optimize SELK alert correlation, success judgment, alert shaping, output fields, or Elasticsearch-facing document structure. This skill analyzes whether the issue belongs in probe correlator, go-engine evaluator, sink logic, or spans multiple layers; outputs a fixed proposal first; and only edits logic files after the user explicitly says to implement, start, land, or directly modify the pipeline.
---

# SELK Alert Pipeline Optimizer

This skill is for alert-pipeline optimization in the SELK repository, especially these logic layers:

- `probe/internal/pipeline/correlator.go`
- `go-engine/internal/evaluate/evaluator.go`
- `go-engine/internal/sink/*`

Default mode is **analysis only**. Do not edit files unless the user explicitly says to implement the proposal, such as `开始实施`, `直接改`, `落地`, or equivalent.

## Goals

When the user says an alert is wrong, incomplete, or not shaped as expected, do all of the following:

1. Identify which pipeline layer owns the problem
2. Explain the likely root cause in repository terms
3. Propose the smallest reasonable logic change
4. Limit the editable scope to alert-pipeline code and tests
5. Only after explicit approval, modify the underlying implementation

## Phase 1: Normalize the optimization request

Turn the user’s message into this internal structure before proposing changes:

- Symptom type: missing correlation, wrong endpoints, weak success judgment, bad alert metadata, bad sink shape, wrong severity, wrong index-facing fields, or mixed
- Affected stage: probe correlator, go-engine evaluator, sink, or cross-layer
- Current observed behavior
- Desired behavior
- Whether the issue is about raw detection, enrichment, output shape, or display/readability
- Whether the problem is isolated to one behavior class or systemic

If the user gives only a vague complaint, ask only the minimum follow-up needed.

## Phase 2: Locate the owning layer

Use this framework.

### Correlator layer

Prefer `probe/internal/pipeline/correlator.go` when the problem is about alert-to-HTTP association, such as:

- `correlated_http` missing unexpectedly
- wrong HTTP event attached to an alert
- `flow_id` or `tx_id` fallback behavior not matching expectations
- TTL or pending release behavior needing adjustment

### Evaluator layer

Prefer `go-engine/internal/evaluate/evaluator.go` when the problem is about enrichment or security judgment, such as:

- `attack_stage` or `attack_success` logic is wrong
- success hints are too weak or too strong
- behavior detection or alert shaping needs adjustment
- alert metadata should be added or preserved differently

### Sink layer

Prefer `go-engine/internal/sink/*` when the problem is about final output document structure, such as:

- `source` / `destination` mapping is wrong
- `event.severity` or `rule.*` fields are incomplete or inconsistent
- ES-facing document shape is not suitable for search, aggregation, or display

### Cross-layer

Choose cross-layer only when multiple layers genuinely contribute to the observed problem.

Always explain *why* the issue belongs there.

## Phase 3: Reuse repository anchors first

Before proposing a change, inspect and reuse these assets:

- `probe/internal/pipeline/correlator.go`
- `probe/internal/pipeline/correlator_test.go`
- `go-engine/internal/evaluate/evaluator.go`
- `go-engine/internal/evaluate/*test.go`
- `go-engine/internal/sink/es.go`
- `go-engine/internal/sink/es_test.go`

You must answer these questions in your own reasoning before proposing changes:

1. Which layer actually owns the symptom?
2. Is there already a helper or test pattern to extend?
3. Can the issue be fixed without widening scope into configs, deployment, or rule libraries?

## Phase 4: Output format for analysis mode

When the user has **not** authorized implementation yet, always respond in this exact structure:

### 问题归类
- What is wrong with the current alert behavior
- Whether it is correlation, evaluator, sink, or cross-layer

### 链路定位
- Exact ownership layer and why

### 建议修改文件
- Exact file paths likely to change

### 拟优化逻辑
- Concrete behavior changes to make
- Keep this at the logic level, not vague recommendations

### 风险与兼容性
- What existing behaviors could be affected
- Whether backward output shape or alert semantics may change

### 验证方式
- Focused tests to run
- Expected before/after behavior

### 待你确认后实施
- End by stating that no files have been changed yet
- Tell the user to say `开始实施` if they want you to apply the proposal

## Phase 5: Implementation mode

Only enter this phase when the user explicitly authorizes implementation.

Default editable scope:

- `probe/internal/pipeline/correlator.go`
- `probe/internal/pipeline/correlator_test.go`
- `go-engine/internal/evaluate/evaluator.go`
- `go-engine/internal/evaluate/*test.go`
- `go-engine/internal/sink/*.go`
- `go-engine/internal/sink/*test.go`

If the requested change would require modifying startup config, deployment config, Logstash, Kafka producer/consumer behavior, or rule libraries, stop and explain why before editing those areas.

If the real task is adding a new detection rule rather than optimizing alert logic, direct the work to `rule-library-writer` instead.

## Repository-specific guidance

### Correlator side

- Keep changes aligned with existing `flow_id + tx_id + TTL` correlation behavior unless the user explicitly wants a policy change
- Prefer adjusting matching or release behavior through the current helpers rather than adding a parallel correlation path

### Evaluator side

- Preserve the distinction between attempt/probable/confirmed semantics unless the user explicitly wants that model changed
- Prefer adding or refining helper logic rather than scattering new branches across `Evaluate(...)`
- Respect existing alert-shaped output patterns where they already exist

### Sink side

- Treat sink logic as output shaping, not primary detection
- Prefer extending `enrichDocumentForES(...)` and its helpers instead of duplicating field derivation logic elsewhere
- Keep `rule.*`, `event.severity`, `source`, and `destination` consistent with current conventions

## Verification expectations after implementation

If you actually edit files, verify proportionally:

- For correlator changes:
  - run the relevant probe correlator tests
- For evaluator changes:
  - `GOWORK=off go -C go-engine test ./internal/evaluate`
  - plus `./internal/normalize` if needed
- For sink changes:
  - `GOWORK=off go -C go-engine test ./internal/sink`
- For cross-layer changes:
  - run the smallest relevant test set per layer and provide one end-to-end expected event flow

## Example triggers

Use this skill when the user says things like:

- `这个告警关联得不对，帮我优化`
- `这个告警的 success 判定要调整`
- `这个告警输出到 ES 的字段不合理`
- `需要优化 correlated_http`
- `需要优化 evaluator 的告警逻辑`
- `sink 这边的告警结构要调整`

## Behavioral guardrails

- Do not skip the proposal phase unless the user explicitly asked for direct implementation
- Do not silently widen scope into deployment or configuration layers
- Do not treat new rule requests as pipeline-logic work
- Do not say a logic change is implemented when you only produced a draft
