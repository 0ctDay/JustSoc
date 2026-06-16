// Claude Code Bridge 与平台同容器运行，固定通过容器内 loopback 访问。
// 不再做成可配置项（历史上的 SELK_CLAUDE_BRIDGE_BASE_URL / 设置页 Base URL 已移除）。
export const CLAUDE_BRIDGE_BASE_URL = 'http://127.0.0.1:4317';
