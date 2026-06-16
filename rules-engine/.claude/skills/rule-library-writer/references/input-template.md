# Packet Key Point Input Template

When the user gives incomplete traffic clues, normalize them into this shape.

## Minimal input model

- Attack category:
- Entry location: URL / query / body / header / cookie / response / DNS
- Raw key fragments:
- Encoded variants to cover:
- Success indicators:
- Example request or response snippets:
- Whether this looks like an extension of an existing rule family:

## Example

- Attack category: rce
- Entry location: header + URL
- Raw key fragments:
  - `/actuator/env`
  - `spring.cloud.function.routing-expression`
  - `T(java.lang.Runtime)`
- Encoded variants to cover:
  - URL-encoded parentheses and dots
  - mixed case header names
- Success indicators:
  - command output echo
  - callback domain appearance
- Example request or response snippets:
  - `GET /actuator/env`
  - `spring.cloud.function.routing-expression:T(java.lang.Runtime).getRuntime().exec(...)`
- Existing rule family guess:
  - `web-spring.rules`
  - `engine.spring.framework.001`

## Output contract in analysis mode

Always present:

1. 归类结果
2. 建议落点
3. 拟修改文件
4. 规则草案
5. 测试与验证方式
6. 待你确认后实施

Do not edit files in analysis mode.
