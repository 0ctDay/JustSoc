export const CLAUDE_CODE_BRIDGE_PERMISSION_MODES = [
  'default',
  'acceptEdits',
  'bypassPermissions',
  'plan',
  'dontAsk',
  'auto',
] as const;

export type ClaudeCodeBridgePermissionMode = (typeof CLAUDE_CODE_BRIDGE_PERMISSION_MODES)[number];

export const CLAUDE_CODE_BRIDGE_EFFORTS = ['low', 'medium', 'high', 'max'] as const;

export type ClaudeCodeBridgeEffort = (typeof CLAUDE_CODE_BRIDGE_EFFORTS)[number];

export const CLAUDE_CODE_BRIDGE_REQUIRED_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
] as const;

export type ClaudeCodeBridgeRequiredEnvKey = (typeof CLAUDE_CODE_BRIDGE_REQUIRED_ENV_KEYS)[number];

export type ClaudeCodeBridgeSettings = {
  additionalDirectoriesText: string;
  model: string;
  permissionMode: ClaudeCodeBridgePermissionMode;
  effort: ClaudeCodeBridgeEffort;
  maxTurns: number;
  systemPromptAppend: string;
  debug: boolean;
  strictMcpConfig: boolean;
  loadSettingsUser: boolean;
  loadSettingsProject: boolean;
  loadSettingsLocal: boolean;
  anthropicBaseUrl: string;
  anthropicAuthToken: string;
  claudeCodeDisableNonessentialTraffic: string;
  envVarsText: string;
  allowedToolsText: string;
  disallowedToolsText: string;
  elasticsearchEnabled: boolean;
  elasticsearchEndpoint: string;
  elasticsearchApiKey: string;
  elasticsearchBearerToken: string;
  elasticsearchUsername: string;
  elasticsearchPassword: string;
  elasticsearchHeadersJson: string;
};

export type ClaudeCodeBridgeRuntimeConfigPayload = {
  additionalDirectories?: string[];
  model?: string;
  permissionMode: ClaudeCodeBridgePermissionMode;
  effort: ClaudeCodeBridgeEffort;
  maxTurns?: number;
  systemPromptAppend?: string;
  debug: boolean;
  strictMcpConfig: boolean;
  loadSettings: {
    user: boolean;
    project: boolean;
    local: boolean;
  };
  envVars: Array<{ key: string; value: string }>;
  allowedTools: string[];
  disallowedTools: string[];
  elasticsearch: {
    enabled: boolean;
    endpoint?: string;
    apiKey?: string;
    bearerToken?: string;
    username?: string;
    password?: string;
    headersJson?: string;
  };
};

export type ClaudeBridgeTaskLogEntry = {
  id: string;
  kind:
    | 'user_message'
    | 'assistant_message'
    | 'assistant_partial'
    | 'system'
    | 'task_result'
    | 'tool_progress'
    | 'task_progress'
    | 'permission_request'
    | 'auth_status'
    | 'stderr'
    | 'error';
  createdAt: string;
  text?: string;
  payload?: unknown;
};

export type ClaudeBridgePendingRequest = {
  requestId: string;
  mode: 'approval' | 'question';
  toolName: string;
  toolUseId: string;
  createdAt: string;
  decisionReason?: string;
  blockedPath?: string;
  input: Record<string, unknown>;
  suggestionsAvailable: boolean;
};

export type ClaudeBridgeTaskSnapshot = {
  id: string;
  title: string;
  status: 'idle' | 'running' | 'waiting_input' | 'completed' | 'error' | 'interrupted';
  createdAt: string;
  updatedAt: string;
  currentTurn: number;
  lastError?: string;
  logs: ClaudeBridgeTaskLogEntry[];
  pendingRequest?: ClaudeBridgePendingRequest;
  sdkSession: {
    sessionId: string;
    claudeCodeVersion?: string;
    model?: string;
    permissionMode?: string;
    availableTools?: string[];
    mcpServers?: Array<{ name?: string; status?: string }>;
  };
  result?: {
    subtype: string;
    text?: string;
    errors?: string[];
    totalCostUsd?: number;
    durationMs?: number;
    numTurns?: number;
    stopReason?: string | null;
  };
};

export type ClaudeBridgeTaskEvent =
  | { type: 'snapshot'; task: ClaudeBridgeTaskSnapshot }
  | { type: 'task.updated'; task: ClaudeBridgeTaskSnapshot }
  | { type: 'assistant.partial'; taskId: string; chunk: string; createdAt: string }
  | { type: 'log'; taskId: string; entry: ClaudeBridgeTaskLogEntry }
  | { type: 'error'; taskId: string; message: string; createdAt: string };

export function isClaudeCodeBridgePermissionMode(value: unknown): value is ClaudeCodeBridgePermissionMode {
  return typeof value === 'string' && CLAUDE_CODE_BRIDGE_PERMISSION_MODES.includes(value as ClaudeCodeBridgePermissionMode);
}

export function isClaudeCodeBridgeEffort(value: unknown): value is ClaudeCodeBridgeEffort {
  return typeof value === 'string' && CLAUDE_CODE_BRIDGE_EFFORTS.includes(value as ClaudeCodeBridgeEffort);
}

export function defaultClaudeCodeBridgeSettings(): ClaudeCodeBridgeSettings {
  return {
    additionalDirectoriesText: '',
    model: '',
    permissionMode: 'bypassPermissions',
    effort: 'medium',
    maxTurns: 8,
    systemPromptAppend: '',
    debug: false,
    strictMcpConfig: false,
    loadSettingsUser: true,
    loadSettingsProject: true,
    loadSettingsLocal: true,
    anthropicBaseUrl: '',
    anthropicAuthToken: '',
    claudeCodeDisableNonessentialTraffic: '1',
    envVarsText: '',
    allowedToolsText: 'mcp__elasticsearch__*',
    disallowedToolsText: '',
    elasticsearchEnabled: true,
    elasticsearchEndpoint: '',
    elasticsearchApiKey: '',
    elasticsearchBearerToken: '',
    elasticsearchUsername: '',
    elasticsearchPassword: '',
    elasticsearchHeadersJson: '',
  };
}

export function parseLineList(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseEnvVarsText(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf('=');
      if (separator < 1) {
        return null;
      }
      const key = line.slice(0, separator).trim();
      const envValue = line.slice(separator + 1);
      return key ? { key, value: envValue } : null;
    })
    .filter((item): item is { key: string; value: string } => item !== null);
}

function trimRequiredEnvValue(value: string) {
  return value.trim();
}

export function getMissingClaudeCodeBridgeRequiredEnvKeys(settings: ClaudeCodeBridgeSettings): ClaudeCodeBridgeRequiredEnvKey[] {
  const values: Record<ClaudeCodeBridgeRequiredEnvKey, string> = {
    ANTHROPIC_BASE_URL: trimRequiredEnvValue(settings.anthropicBaseUrl),
    ANTHROPIC_AUTH_TOKEN: trimRequiredEnvValue(settings.anthropicAuthToken),
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: trimRequiredEnvValue(settings.claudeCodeDisableNonessentialTraffic),
  };

  return CLAUDE_CODE_BRIDGE_REQUIRED_ENV_KEYS.filter((key) => !values[key]);
}

export function validateClaudeCodeBridgeSettings(settings: ClaudeCodeBridgeSettings) {
  const missingKeys = getMissingClaudeCodeBridgeRequiredEnvKeys(settings);
  if (missingKeys.length) {
    throw new Error(`Claude Code Bridge 缂哄皯蹇呭～鐜鍙橀噺锛?{missingKeys.join(', ')}`);
  }
}

export function resolveClaudeCodeBridgeEnvVars(settings: ClaudeCodeBridgeSettings) {
  const reservedKeys = new Set<string>(CLAUDE_CODE_BRIDGE_REQUIRED_ENV_KEYS);
  const extraEnvVars = parseEnvVarsText(settings.envVarsText).filter((entry) => !reservedKeys.has(entry.key));

  const requiredEnvVars = [
    { key: 'ANTHROPIC_BASE_URL', value: trimRequiredEnvValue(settings.anthropicBaseUrl) },
    { key: 'ANTHROPIC_AUTH_TOKEN', value: trimRequiredEnvValue(settings.anthropicAuthToken) },
    { key: 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', value: trimRequiredEnvValue(settings.claudeCodeDisableNonessentialTraffic) },
  ].filter((entry) => entry.value);

  return [...requiredEnvVars, ...extraEnvVars];
}

export function buildClaudeCodeBridgeRuntimeConfig(settings: ClaudeCodeBridgeSettings): ClaudeCodeBridgeRuntimeConfigPayload {
  validateClaudeCodeBridgeSettings(settings);

  return {
    additionalDirectories: parseLineList(settings.additionalDirectoriesText),
    model: settings.model.trim() || undefined,
    permissionMode: settings.permissionMode,
    effort: settings.effort,
    maxTurns: Number.isFinite(settings.maxTurns) && settings.maxTurns > 0 ? settings.maxTurns : undefined,
    systemPromptAppend: settings.systemPromptAppend.trim() || undefined,
    debug: settings.debug,
    strictMcpConfig: settings.strictMcpConfig,
    loadSettings: {
      user: settings.loadSettingsUser,
      project: settings.loadSettingsProject,
      local: settings.loadSettingsLocal,
    },
    envVars: resolveClaudeCodeBridgeEnvVars(settings),
    allowedTools: parseLineList(settings.allowedToolsText),
    disallowedTools: parseLineList(settings.disallowedToolsText),
    elasticsearch: {
      enabled: settings.elasticsearchEnabled,
      endpoint: settings.elasticsearchEndpoint.trim() || undefined,
      apiKey: settings.elasticsearchApiKey.trim() || undefined,
      bearerToken: settings.elasticsearchBearerToken.trim() || undefined,
      username: settings.elasticsearchUsername.trim() || undefined,
      password: settings.elasticsearchPassword || undefined,
      headersJson: settings.elasticsearchHeadersJson.trim() || undefined,
    },
  };
}
