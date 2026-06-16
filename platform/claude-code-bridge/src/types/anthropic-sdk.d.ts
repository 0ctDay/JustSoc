declare module "@anthropic-ai/claude-agent-sdk" {
  export type PermissionMode =
    | "default"
    | "acceptEdits"
    | "bypassPermissions"
    | "plan"
    | "dontAsk"
    | "auto";

  export type PermissionUpdate = Record<string, unknown>;

  export type PermissionResult =
    | {
        behavior: "allow";
        updatedInput?: Record<string, unknown>;
        updatedPermissions?: PermissionUpdate[];
        toolUseID?: string;
      }
    | {
        behavior: "deny";
        message: string;
        interrupt?: boolean;
        toolUseID?: string;
      };

  export type SDKUserMessage = {
    type: "user";
    uuid?: string;
    session_id: string;
    message: {
      role: "user";
      content: unknown;
    };
    parent_tool_use_id: string | null;
    isSynthetic?: boolean;
    tool_use_result?: unknown;
  };

  export type SDKAssistantMessage = {
    type: "assistant";
    uuid: string;
    session_id: string;
    message: {
      id?: string;
      model?: string;
      content?: unknown;
      stop_reason?: string | null;
      usage?: unknown;
    };
    parent_tool_use_id: string | null;
    error?: string;
  };

  export type SDKPartialAssistantMessage = {
    type: "stream_event";
    event: Record<string, unknown>;
    parent_tool_use_id: string | null;
    uuid: string;
    session_id: string;
  };

  export type SDKResultMessage = {
    type: "result";
    subtype: string;
    uuid: string;
    session_id: string;
    duration_ms: number;
    duration_api_ms: number;
    is_error: boolean;
    num_turns: number;
    result?: string;
    stop_reason: string | null;
    total_cost_usd: number;
    usage?: unknown;
    modelUsage?: Record<string, unknown>;
    permission_denials?: Array<{
      tool_name: string;
      tool_use_id: string;
      tool_input: Record<string, unknown>;
    }>;
    structured_output?: unknown;
    errors?: string[];
  };

  export type SDKSystemMessage = {
    type: "system";
    subtype: string;
    uuid: string;
    session_id: string;
    [key: string]: unknown;
  };

  export type SDKToolProgressMessage = {
    type: "tool_progress";
    tool_use_id: string;
    tool_name: string;
    parent_tool_use_id: string | null;
    elapsed_time_seconds: number;
    task_id?: string;
    uuid: string;
    session_id: string;
  };

  export type SDKAuthStatusMessage = {
    type: "auth_status";
    isAuthenticating: boolean;
    output: string[];
    error?: string;
    uuid: string;
    session_id: string;
  };

  export type SDKMessage =
    | SDKAssistantMessage
    | SDKUserMessage
    | SDKResultMessage
    | SDKSystemMessage
    | SDKPartialAssistantMessage
    | SDKToolProgressMessage
    | SDKAuthStatusMessage;

  export type McpServerConfig =
    | {
        type?: "stdio";
        command: string;
        args?: string[];
        env?: Record<string, string>;
      }
    | {
        type: "sse" | "http";
        url: string;
        headers?: Record<string, string>;
      };

  export type Options = {
    abortController?: AbortController;
    additionalDirectories?: string[];
    allowDangerouslySkipPermissions?: boolean;
    allowedTools?: string[];
    canUseTool?: (
      toolName: string,
      input: Record<string, unknown>,
      options: {
        signal: AbortSignal;
        suggestions?: PermissionUpdate[];
        blockedPath?: string;
        decisionReason?: string;
        toolUseID: string;
        agentID?: string;
      },
    ) => Promise<PermissionResult>;
    cwd?: string;
    disallowedTools?: string[];
    effort?: "low" | "medium" | "high" | "max";
    env?: Record<string, string | undefined>;
    includePartialMessages?: boolean;
    maxTurns?: number;
    mcpServers?: Record<string, McpServerConfig>;
    model?: string;
    permissionMode?: PermissionMode;
    persistSession?: boolean;
    resume?: string;
    sessionId?: string;
    settingSources?: Array<"user" | "project" | "local">;
    stderr?: (data: string) => void;
    strictMcpConfig?: boolean;
    systemPrompt?:
      | string
      | {
          type: "preset";
          preset: "claude_code";
          append?: string;
        };
    toolConfig?: {
      askUserQuestion?: {
        previewFormat?: "markdown" | "html";
      };
    };
    tools?: string[] | { type: "preset"; preset: "claude_code" };
  };

  export interface Query extends AsyncGenerator<SDKMessage, void> {
    interrupt(): Promise<void>;
    streamInput(stream: AsyncIterable<SDKUserMessage>): Promise<void>;
    stopTask(taskId: string): Promise<void>;
    initializationResult(): Promise<Record<string, unknown>>;
    mcpServerStatus(): Promise<Array<Record<string, unknown>>>;
    setPermissionMode(mode: PermissionMode): Promise<void>;
    setModel(model?: string): Promise<void>;
    close(): void;
  }

  export type SDKSessionInfo = {
    sessionId: string;
    summary: string;
    lastModified: number;
    fileSize?: number;
    customTitle?: string;
    firstPrompt?: string;
    gitBranch?: string;
    cwd?: string;
    tag?: string;
    createdAt?: number;
  };

  export type SessionMessage = {
    type: "user" | "assistant";
    uuid: string;
    session_id: string;
    message: unknown;
    parent_tool_use_id: string | null;
  };

  export function query(args: {
    prompt: string | AsyncIterable<SDKUserMessage>;
    options?: Options;
  }): Query;

  export function listSessions(options?: {
    dir?: string;
    limit?: number;
    includeWorktrees?: boolean;
  }): Promise<SDKSessionInfo[]>;

  export function getSessionMessages(
    sessionId: string,
    options?: {
      dir?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<SessionMessage[]>;

  export function getSessionInfo(
    sessionId: string,
    options?: {
      dir?: string;
    },
  ): Promise<SDKSessionInfo | undefined>;
}
