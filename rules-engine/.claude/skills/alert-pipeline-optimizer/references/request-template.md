# Alert Optimization Request Template

When the user describes an alert problem, normalize it into this structure.

## Minimal input model

- Current symptom:
- Expected behavior:
- Suspected stage if any: correlator / evaluator / sink / unknown
- Example event fields or screenshots:
- Whether the problem is isolated or affects a whole class of alerts:
- Any known regression point or recent related change:

## Example

- Current symptom:
  - directory scan alerts enter ES, but `source` and `destination` look reversed
- Expected behavior:
  - source should be the client scanner and destination should be the target host
- Suspected stage if any:
  - sink
- Example event fields or screenshots:
  - `correlated_http.src_ip=10.0.0.10`
  - output `source.ip=10.0.0.20`
- Whether the problem is isolated or affects a whole class of alerts:
  - affects alert-shaped events using correlated HTTP context
- Any known regression point or recent related change:
  - appeared after alert enrichment changes

## Output contract in analysis mode

Always present:

1. 问题归类
2. 链路定位
3. 建议修改文件
4. 拟优化逻辑
5. 风险与兼容性
6. 验证方式
7. 待你确认后实施

Do not edit files in analysis mode.
