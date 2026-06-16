---
name: aggregation-attack-investigation
description: Use for SELK aggregation investigation tasks that must determine whether an alert bucket contains a real successful attack and, if so, reconstruct the attack chain with Elasticsearch MCP while minimizing token and log cost.
---

# Aggregation Attack Investigation

Use this skill when the task context already contains a SELK aggregation bucket, summary data, and representative samples.

## Workflow

1. Treat summary data and representative samples as anchors only. They help you choose pivots, but they are not full evidence.
2. First answer whether the bucket contains an actually successful attack. Do not equate scanning, probing, or a rule hit with success.
3. If success is not proven, conclude `未确认成功` or `未发现成功证据`. Do not fabricate a complete attack chain.
4. If success is proven or highly likely, use Elasticsearch MCP to investigate the whole bucket and related context:
   - Start with the provided bucket filters.
   - Pivot by target IP, URL, port, signature, attack stage, and adjacent time windows.
   - Reconstruct the chain from start to probing to exploitation, and include follow-on activity only if logs support it.

## Efficiency Rules

1. Prefer count, aggregation, topN, and time slicing before fetching raw events.
2. Narrow scope first, then fetch a small number of key documents.
3. Request only fields needed to prove each step.
4. Avoid dumping long payloads, full HTTP bodies, or large raw log sets unless they are necessary evidence.

## Output

Output exactly these four sections and keep them concise:

1. `攻击成功的结论和证据`
   - State one of `已确认成功` / `未确认成功` / `暂不能确认成功`.
   - Keep only the strongest evidence.
2. `从开始-探测-利用的时间线梳理`
   - Use time order.
   - If success is not confirmed, stop at the last observed stage and call out the missing proof.
3. `串联事件分析需求（由用户决定是否需要）`
   - Give optional next pivots only.
4. `处置方式`
   - Give short, executable response actions.