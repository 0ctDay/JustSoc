import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";

export type SettingsSourcesInput = {
  user: boolean;
  project: boolean;
  local: boolean;
};

export type RuntimeEnvVarInput = {
  key: string;
  value: string;
};

export type ElasticsearchMcpInput = {
  enabled: boolean;
  endpoint?: string;
  apiKey?: string;
  bearerToken?: string;
  username?: string;
  password?: string;
  headersJson?: string;
};

export type TaskRuntimeConfigInput = {
  additionalDirectories?: string[];
  model?: string;
  permissionMode?: PermissionMode;
  effort?: "low" | "medium" | "high" | "max";
  maxTurns?: number;
  systemPromptAppend?: string;
  debug?: boolean;
  strictMcpConfig?: boolean;
  loadSettings?: Partial<SettingsSourcesInput>;
  envVars?: RuntimeEnvVarInput[];
  allowedTools?: string[];
  disallowedTools?: string[];
  elasticsearch?: Partial<ElasticsearchMcpInput>;
};

export type StartTaskRequest = {
  title?: string;
  prompt: string;
  config?: TaskRuntimeConfigInput;
};

export type SendMessageRequest = {
  content: string;
  config?: TaskRuntimeConfigInput;
};

export type TaskDecisionRequest = {
  requestId: string;
  decision: "allow" | "allow_always" | "deny";
  message?: string;
  updatedInputJson?: string;
  answers?: Record<string, string | string[]>;
};

export type TaskLogKind =
  | "user_message"
  | "assistant_message"
  | "assistant_partial"
  | "system"
  | "task_result"
  | "tool_progress"
  | "task_progress"
  | "permission_request"
  | "auth_status"
  | "stderr"
  | "error";

export type TaskLogEntry = {
  id: string;
  kind: TaskLogKind;
  createdAt: string;
  text?: string;
  payload?: unknown;
};

export type TaskStatus =
  | "idle"
  | "running"
  | "waiting_input"
  | "completed"
  | "error"
  | "interrupted";

export type PendingRequestMode = "approval" | "question";

export type PendingRequestSnapshot = {
  requestId: string;
  mode: PendingRequestMode;
  toolName: string;
  toolUseId: string;
  createdAt: string;
  decisionReason?: string;
  blockedPath?: string;
  input: Record<string, unknown>;
  suggestionsAvailable: boolean;
};

export type SanitizedTaskRuntimeConfig = {
  cwd: string;
  additionalDirectories: string[];
  model?: string;
  permissionMode: PermissionMode;
  effort: "low" | "medium" | "high" | "max";
  maxTurns?: number;
  systemPromptAppend?: string;
  debug: boolean;
  strictMcpConfig: boolean;
  loadSettings: SettingsSourcesInput;
  envKeys: string[];
  allowedTools: string[];
  disallowedTools: string[];
  elasticsearch: {
    enabled: boolean;
    endpoint?: string;
    hasApiKey: boolean;
    hasBearerToken: boolean;
    username?: string;
    hasPassword: boolean;
    hasHeadersJson: boolean;
  };
};

export type ClaudeTaskSnapshot = {
  id: string;
  title: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  currentTurn: number;
  lastError?: string;
  config: SanitizedTaskRuntimeConfig;
  logs: TaskLogEntry[];
  pendingRequest?: PendingRequestSnapshot;
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
    permissionDenials?: Array<{
      toolName: string;
      toolUseId: string;
      toolInput: Record<string, unknown>;
    }>;
  };
};

export type TaskEvent =
  | { type: "snapshot"; task: ClaudeTaskSnapshot }
  | { type: "task.updated"; task: ClaudeTaskSnapshot }
  | { type: "assistant.partial"; taskId: string; chunk: string; createdAt: string }
  | { type: "log"; taskId: string; entry: TaskLogEntry }
  | { type: "error"; taskId: string; message: string; createdAt: string };
