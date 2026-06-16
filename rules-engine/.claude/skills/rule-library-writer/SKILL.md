---
name: rule-library-writer
description: Use this skill when the user provides packet key points, payload fragments, URI/header/body indicators, response clues, exploit traits, or asks to add/update SELK detection rules. This skill analyzes whether the new detection belongs in Suricata rules, go-engine rules, or both; outputs a fixed proposal first; and only edits files after the user explicitly says to implement, start, land, or directly modify the rules.
---

# SELK Rule Library Writer

This skill is for the SELK project’s two-layer detection chain:

- `probe/suricata-rules/*.rules` for first-pass Suricata alerts from raw traffic
- `go-engine/configs/engine-rules.yaml` for flexible second-pass matching and enrichment in go-engine

Default mode is **analysis only**. Do not edit files unless the user explicitly says to implement the proposal, such as `开始实施`, `直接改`, `落地`, or equivalent.

## Goals

When the user gives attack clues instead of a fully formed rule, do all of the following:

1. Normalize the clues into a structured detection summary
2. Decide the correct rule placement: Suricata, go-engine, or both
3. Reuse existing rule files and patterns instead of inventing a new layout
4. Output a fixed proposal format the user can quickly approve
5. Only after explicit approval, edit the actual rule and test files

## Phase 1: Normalize the input

Turn the user’s message into this internal structure before proposing changes:

- Attack category: `sqli`, `xss`, `rce`, `cmdi`, `file_read`, `upload`, `log4j`, `fastjson`, or `other`
- Entry location: URL, query, request body, header, cookie, response body, DNS, or multi-field
- Stable keywords or fragments
- Encoded variants: URL-encoded, double-encoded, Unicode-escaped, mixed case, path separators
- Success indicators: error response, callback, sensitive file content, command output, response echo
- Matching confidence: strong single indicator vs weak multi-signal pattern
- Existing nearby rules that may need extension instead of a new rule

If the user gives incomplete clues, ask only the minimum needed follow-up questions.

## Phase 2: Decide where the rule belongs

Use this placement framework.

### Suricata only

Prefer `probe/suricata-rules/*.rules` when the detection can be expressed as stable traffic-layer signatures, such as:

- fixed exploit paths
- specific HTTP methods + URIs
- obvious header or cookie markers
- deterministic body fragments
- known protocol fields that Suricata can match directly

### go-engine only

Prefer `go-engine/configs/engine-rules.yaml` when the detection is better expressed as flexible content logic, such as:

- combined matching across `payload_printable` and `http_url`
- weaker exploit hints that need grouped tokens
- patterns benefiting from normalization or correlation context
- logic that depends on `correlated_http`, success hints, or later evaluator behavior

### Both

Choose both layers when:

- Suricata should catch the raw exploit fast
- go-engine should add stronger categorization, success reasoning, or broader fallback matching

Always explain *why* you chose the placement.

## Phase 3: Reuse project patterns first

Before proposing a new rule, inspect and reuse these assets:

- `probe/suricata-rules/web-*.rules`
- `go-engine/configs/engine-rules.yaml`
- `go-engine/internal/rules/loader.go`
- `go-engine/internal/evaluate/highlight_rules.go`
- `probe/internal/pipeline/correlator.go`
- `go-engine/cmd/threat-engine/main.go`

You must answer these questions in your own reasoning before proposing changes:

1. Which existing rule file is the closest match?
2. Should this be an extension of an existing rule set or a net-new rule?
3. Do any new keywords also need to be reflected in the highlighter or success-hint-adjacent logic?

## Phase 4: Output format for analysis mode

When the user has **not** authorized implementation yet, always respond in this exact structure:

### 归类结果
- Attack category
- Main indicators
- Encoding or evasion variants worth covering

### 建议落点
- `Suricata only`, `go-engine only`, or `both`
- Brief reason tied to this repository’s rule chain

### 拟修改文件
- Exact file paths that would likely change

### 规则草案
- Proposed Suricata rule fragments and/or YAML rule entries
- Keep them concrete, but do not claim they are already applied

### 测试与验证方式
- Focused tests or sample traffic to run
- Mention which layer should hit first and what output is expected

### 待你确认后实施
- End by stating that no files have been changed yet
- Tell the user to say `开始实施` if they want you to apply the proposal

## Phase 5: Implementation mode

Only enter this phase when the user explicitly authorizes implementation.

Default editable scope:

- `probe/suricata-rules/*.rules`
- `go-engine/configs/engine-rules.yaml`
- necessary `go-engine/internal/*test.go`
- necessary `probe/internal/*test.go`

If implementation would require broader code changes in pipeline, evaluator, sink, or runtime logic, stop and explain why before editing those files.

## Repository-specific guidance

### Suricata side

- Keep file placement aligned with existing `web-*.rules` grouping
- Prefer extending the nearest existing category file before introducing a new file
- Keep SID usage and naming consistent with neighboring rules in the same file

### go-engine side

- Match the existing YAML schema in `go-engine/configs/engine-rules.yaml`
- Reuse the same category vocabulary already present in the repository
- Favor adding concise content logic instead of introducing new code paths unless truly necessary

### Correlated HTTP awareness

- Remember that `correlated_http` is generated in `probe/internal/pipeline/correlator.go`
- It is alert-attached HTTP context, not an independently authored field
- Use this knowledge when deciding whether a pattern should rely on raw HTTP fields, alert context, or go-engine correlation-aware fields

## Verification expectations after implementation

If you actually edit files, verify proportionally:

- For go-engine rule changes:
  - `GOWORK=off go -C go-engine test ./internal/rules`
  - plus `./internal/evaluate` or `./internal/normalize` if the change affects them
- For probe-side test changes, run the narrowest relevant probe tests
- For cross-layer changes, provide an end-to-end traffic sample and expected match path

## Example triggers

Use this skill when the user says things like:

- `根据这个 payload 帮我补规则`
- `这是新攻击数据包关键点，帮我分析该加到哪层规则库`
- `给这个漏洞补 Suricata 规则`
- `给这个漏洞补 go-engine 规则`
- `这是新的利用特征，看看规则怎么写`

## Behavioral guardrails

- Do not skip the proposal phase unless the user explicitly asked for direct implementation
- Do not silently widen scope beyond rules and tests
- Do not invent a new rule architecture when an existing category file already fits
- Do not say a rule is implemented when you only produced a draft
