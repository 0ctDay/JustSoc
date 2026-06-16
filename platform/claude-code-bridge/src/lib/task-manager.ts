import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import type {
  McpServerConfig,
  PermissionMode,
  PermissionResult,
  PermissionUpdate,
  Query,
  SDKAssistantMessage,
  SDKAuthStatusMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
  SDKSystemMessage,
  SDKToolProgressMessage,
} from "@anthropic-ai/claude-agent-sdk";

import type {
  ClaudeTaskSnapshot,
  ElasticsearchMcpInput,
  PendingRequestMode,
  PendingRequestSnapshot,
  SanitizedTaskRuntimeConfig,
  SendMessageRequest,
  SettingsSourcesInput,
  StartTaskRequest,
  TaskDecisionRequest,
  TaskEvent,
  TaskLogEntry,
  TaskRuntimeConfigInput,
} from "./types.js";
import { TaskStore } from "./task-store.js";

type Subscriber = (event: TaskEvent) => void;

type ResolvedRuntimeConfig = {
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
  env: Record<string, string>;
  allowedTools: string[];
  disallowedTools: string[];
  elasticsearch: Required<Pick<ElasticsearchMcpInput, "enabled">> &
    Omit<ElasticsearchMcpInput, "enabled">;
};

type DeferredPermission = {
  resolve: (value: PermissionResult) => void;
  reject: (reason?: unknown) => void;
  promise: Promise<PermissionResult>;
  request: PendingRequestSnapshot;
  suggestions?: PermissionUpdate[];
};

type LiveTaskState = {
  runtime: ResolvedRuntimeConfig;
  activeQuery?: Query;
  abortController?: AbortController;
  pendingPermission?: DeferredPermission;
  partialAssistantText: string;
};

const APP_ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const WORKSPACE_ROOT = path.resolve(process.cwd(), "workspace");
const WORKSPACE_CLAUDE_ROOT = path.join(WORKSPACE_ROOT, ".claude");
const REPO_ROOT = path.resolve(APP_ROOT, "..");
const DATA_ROOT = path.join(APP_ROOT, "data");
const TASK_STORE_DIR = path.join(DATA_ROOT, "tasks");
const ES_MCP_SCRIPT = path.join(WORKSPACE_ROOT, "scripts", "es-mcp-server.mjs");
const DEFAULT_ES_ENDPOINT = resolveDefaultElasticsearchEndpoint();
const DEFAULT_LOAD_SETTINGS: SettingsSourcesInput = {
  user: true,
  project: true,
  local: true,
};
let sdkModulePromise:
  | Promise<typeof import("@anthropic-ai/claude-agent-sdk")>
  | undefined;

function resolveDefaultElasticsearchEndpoint() {
  const fallback =
    process.env.SELK_ES_ENDPOINT ??
    process.env.SELK_ELASTICSEARCH_URL ??
    process.env.ELASTICSEARCH_URL ??
    process.env.ES_URL ??
    "http://elasticsearch:9200";

  try {
    const raw = readFileSync(path.join(WORKSPACE_CLAUDE_ROOT, ".mcp.json"), "utf8");
    const parsed = JSON.parse(raw) as {
      mcpServers?: {
        elasticsearch?: {
          env?: Record<string, unknown>;
        };
      };
    };

    const endpoint = parsed.mcpServers?.elasticsearch?.env?.SELK_ES_ENDPOINT;
    return typeof endpoint === "string" && endpoint.trim() ? endpoint.trim() : fallback;
  } catch {
    return fallback;
  }
}

function isoNow() {
  return new Date().toISOString();
}

function toSingleLinePreview(value: string, limit = 72) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "New task";
  }
  return normalized.length > limit ? `${normalized.slice(0, limit - 3)}...` : normalized;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === "string");
}

function safeJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function sanitizeHeadersJson(headersJson?: string) {
  const trimmed = headersJson?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeStringArray(values: string[] | undefined) {
  return (values ?? [])
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveStringArray(
  incoming: string[] | undefined,
  existing: string[] | undefined,
  fallback: string[],
) {
  if (incoming !== undefined) {
    return normalizeStringArray(incoming);
  }
  return existing ?? fallback;
}

function extractTextFromMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return safeJson(content);
  }

  const parts: string[] = [];

  for (const block of content) {
    const record = asObject(block);
    if (!record) {
      continue;
    }

    if (record.type === "text" && typeof record.text === "string") {
      parts.push(record.text);
      continue;
    }

    if (record.type === "tool_use" && typeof record.name === "string") {
      parts.push(`[tool:${record.name}]`);
      continue;
    }

    if (record.type === "tool_result") {
      parts.push("[tool_result]");
      continue;
    }
  }

  return parts.join("\n").trim() || safeJson(content);
}

function extractTextDelta(message: SDKPartialAssistantMessage) {
  const event = asObject(message.event);
  if (!event) {
    return "";
  }

  if (event.type === "content_block_delta") {
    const delta = asObject(event.delta);
    if (delta?.type === "text_delta" && typeof delta.text === "string") {
      return delta.text;
    }
  }

  if (typeof event.text === "string") {
    return event.text;
  }

  return "";
}

function createDeferredPermission(
  request: PendingRequestSnapshot,
  suggestions?: PermissionUpdate[],
): DeferredPermission {
  let resolve!: (value: PermissionResult) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<PermissionResult>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { resolve, reject, promise, request, suggestions };
}

function mergeSettingsSources(
  current: SettingsSourcesInput | undefined,
  incoming: Partial<SettingsSourcesInput> | undefined,
): SettingsSourcesInput {
  return {
    user: incoming?.user ?? current?.user ?? DEFAULT_LOAD_SETTINGS.user,
    project: incoming?.project ?? current?.project ?? DEFAULT_LOAD_SETTINGS.project,
    local: incoming?.local ?? current?.local ?? DEFAULT_LOAD_SETTINGS.local,
  };
}

function parseHeadersJson(headersJson?: string) {
  const trimmed = sanitizeHeadersJson(headersJson);
  if (!trimmed) {
    return undefined;
  }

  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Elasticsearch MCP headersJson must be a JSON object.");
  }

  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [key, String(value)]),
  );
}

function buildSettingSources(loadSettings: SettingsSourcesInput) {
  const values: Array<"user" | "project" | "local"> = [];
  if (loadSettings.user) values.push("user");
  if (loadSettings.project) values.push("project");
  if (loadSettings.local) values.push("local");
  return values;
}

function isQuestionRequest(toolName: string) {
  return toolName === "AskUserQuestion";
}

async function loadClaudeSdk() {
  try {
    sdkModulePromise ??= import("@anthropic-ai/claude-agent-sdk");
    return await sdkModulePromise;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to load @anthropic-ai/claude-agent-sdk. Run "npm install" in claude-code-bridge first. ${detail}`,
    );
  }
}

export class TaskManager {
  private readonly store = new TaskStore(TASK_STORE_DIR);
  private readonly tasks = new Map<string, ClaudeTaskSnapshot>();
  private readonly live = new Map<string, LiveTaskState>();
  private readonly subscribers = new Map<string, Set<Subscriber>>();

  async init() {
    const snapshots = await this.store.loadAll();

    for (const snapshot of snapshots) {
      const config =
        snapshot.config.cwd === WORKSPACE_ROOT
          ? snapshot.config
          : {
              ...snapshot.config,
              cwd: WORKSPACE_ROOT,
            };

      const task =
        snapshot.status === "running" || snapshot.status === "waiting_input"
          ? {
              ...snapshot,
              config,
              status: "interrupted" as const,
              updatedAt: isoNow(),
              lastError: "Server restarted before the Claude run finished.",
              pendingRequest: undefined,
            }
          : config === snapshot.config
            ? snapshot
            : {
                ...snapshot,
                config,
              };

      this.tasks.set(task.id, task);
      this.live.set(task.id, {
        runtime: this.restoreRuntimeConfig(task),
        partialAssistantText: "",
      });

      if (task !== snapshot) {
        await this.store.save(task);
      }
    }
  }

  getDefaults() {
    return {
      workspaceRoot: WORKSPACE_ROOT,
      repoRoot: REPO_ROOT,
      appRoot: APP_ROOT,
      esMcpScript: ES_MCP_SCRIPT,
      defaultElasticsearchEndpoint: DEFAULT_ES_ENDPOINT,
      defaultLoadSettings: DEFAULT_LOAD_SETTINGS,
    };
  }

  listTasks() {
    return [...this.tasks.values()].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  }

  getTask(taskId: string) {
    return this.tasks.get(taskId);
  }

  subscribe(taskId: string, subscriber: Subscriber) {
    const set = this.subscribers.get(taskId) ?? new Set<Subscriber>();
    set.add(subscriber);
    this.subscribers.set(taskId, set);
    return () => {
      const current = this.subscribers.get(taskId);
      if (!current) {
        return;
      }
      current.delete(subscriber);
      if (current.size === 0) {
        this.subscribers.delete(taskId);
      }
    };
  }

  async createTask(request: StartTaskRequest) {
    const taskId = randomUUID();
    const title = request.title?.trim() || toSingleLinePreview(request.prompt);
    const runtime = this.resolveRuntimeConfig(undefined, request.config);
    const now = isoNow();

    const task: ClaudeTaskSnapshot = {
      id: taskId,
      title,
      status: "idle",
      createdAt: now,
      updatedAt: now,
      currentTurn: 0,
      config: this.sanitizeRuntimeConfig(runtime),
      logs: [],
      sdkSession: {
        sessionId: taskId,
      },
    };

    this.tasks.set(taskId, task);
    this.live.set(taskId, {
      runtime,
      partialAssistantText: "",
    });

    await this.appendLog(task, "user_message", request.prompt);
    void this.runTurn(taskId, request.prompt);
    return task;
  }

  async sendMessage(taskId: string, request: SendMessageRequest) {
    const task = this.requireTask(taskId);
    const live = this.ensureLive(taskId);

    if (live.abortController && task.status !== "completed" && task.status !== "error" && task.status !== "interrupted") {
      if (task.status === "waiting_input") {
        throw new Error("Task is waiting for approval or answers. Use the decision endpoint first.");
      }
      throw new Error("Task is still running. Interrupt it before sending a new message.");
    }

    live.runtime = this.resolveRuntimeConfig(live.runtime, request.config);
    task.config = this.sanitizeRuntimeConfig(live.runtime);
    task.lastError = undefined;
    task.result = undefined;
    task.updatedAt = isoNow();
    await this.store.save(task);
    this.emit({ type: "task.updated", task });

    await this.appendLog(task, "user_message", request.content);
    void this.runTurn(taskId, request.content);
    return task;
  }

  async respondToDecision(taskId: string, request: TaskDecisionRequest) {
    const task = this.requireTask(taskId);
    const live = this.ensureLive(taskId);
    const pending = live.pendingPermission;

    if (!pending || task.pendingRequest?.requestId !== request.requestId) {
      throw new Error("No matching pending request was found.");
    }

    const toolName = pending.request.toolName;
    let result: PermissionResult;

    if (request.decision === "deny") {
      result = {
        behavior: "deny",
        message: request.message?.trim() || "Denied by the web operator.",
        toolUseID: pending.request.toolUseId,
      };
    } else {
      let updatedInput: Record<string, unknown> | undefined;

      if (request.updatedInputJson?.trim()) {
        const parsed = JSON.parse(request.updatedInputJson) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("updatedInputJson must be a JSON object.");
        }
        updatedInput = parsed as Record<string, unknown>;
      } else if (isQuestionRequest(toolName)) {
        const questions = Array.isArray(pending.request.input.questions)
          ? pending.request.input.questions
          : [];
        const answers = request.answers ?? {};
        updatedInput = {
          questions,
          answers,
        };
      } else {
        updatedInput = pending.request.input;
      }

      result = {
        behavior: "allow",
        updatedInput,
        toolUseID: pending.request.toolUseId,
      };

      if (request.decision === "allow_always" && pending.suggestions?.length) {
        result.updatedPermissions = pending.suggestions;
      }
    }

    const decisionLabel =
      request.decision === "allow"
        ? "Allowed once"
        : request.decision === "allow_always"
          ? "Allowed and remembered"
          : "Denied";

    task.pendingRequest = undefined;
    task.status = "running";
    task.updatedAt = isoNow();
    await this.appendLog(
      task,
      "system",
      `${decisionLabel}: ${toolName}`,
      {
        decision: request.decision,
        toolName,
      },
    );

    live.pendingPermission = undefined;
    pending.resolve(result);
    await this.store.save(task);
    this.emit({ type: "task.updated", task });
    return task;
  }

  async interruptTask(taskId: string) {
    const task = this.requireTask(taskId);
    const live = this.ensureLive(taskId);

    live.pendingPermission?.reject(new Error("Interrupted by user."));
    live.pendingPermission = undefined;
    task.pendingRequest = undefined;

    if (live.abortController) {
      live.abortController.abort();
    }

    task.status = "interrupted";
    task.lastError = "Interrupted by the web operator.";
    task.updatedAt = isoNow();
    await this.appendLog(task, "system", "Run interrupted by the web operator.");
    await this.store.save(task);
    this.emit({ type: "task.updated", task });
    return task;
  }

  async deleteTask(taskId: string) {
    const task = this.requireTask(taskId);
    const live = this.ensureLive(taskId);

    live.pendingPermission?.reject(new Error("Task deleted by the operator."));
    live.pendingPermission = undefined;
    if (live.abortController) {
      live.abortController.abort();
    }

    this.live.delete(taskId);
    this.tasks.delete(taskId);
    this.subscribers.delete(taskId);
    await this.store.remove(taskId);

    return task;
  }

  async getSessionInfo(taskId: string) {
    const task = this.requireTask(taskId);
    const sdk = await loadClaudeSdk();
    return sdk.getSessionInfo(task.sdkSession.sessionId);
  }

  private emit(event: TaskEvent) {
    if (event.type === "snapshot") {
      const listeners = this.subscribers.get(event.task.id);
      listeners?.forEach((listener) => listener(event));
      return;
    }

    const taskId =
      event.type === "task.updated" ? event.task.id : event.taskId;
    const listeners = this.subscribers.get(taskId);
    listeners?.forEach((listener) => listener(event));
  }

  private requireTask(taskId: string) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    return task;
  }

  private ensureLive(taskId: string) {
    const live = this.live.get(taskId);
    if (!live) {
      throw new Error(`Live task state not found: ${taskId}`);
    }
    return live;
  }

  private restoreRuntimeConfig(task: ClaudeTaskSnapshot): ResolvedRuntimeConfig {
    return {
      cwd: WORKSPACE_ROOT,
      additionalDirectories: task.config.additionalDirectories,
      model: task.config.model,
      permissionMode: task.config.permissionMode,
      effort: task.config.effort,
      maxTurns: task.config.maxTurns,
      systemPromptAppend: task.config.systemPromptAppend,
      debug: task.config.debug,
      strictMcpConfig: task.config.strictMcpConfig,
      loadSettings: task.config.loadSettings,
      env: {},
      allowedTools: task.config.allowedTools,
      disallowedTools: task.config.disallowedTools,
      elasticsearch: {
        enabled: task.config.elasticsearch.enabled,
        endpoint: task.config.elasticsearch.endpoint,
        apiKey: undefined,
        bearerToken: undefined,
        username: task.config.elasticsearch.username,
        password: undefined,
        headersJson: undefined,
      },
    };
  }

  private resolveRuntimeConfig(
    existing: ResolvedRuntimeConfig | undefined,
    incoming: TaskRuntimeConfigInput | undefined,
  ): ResolvedRuntimeConfig {
    const loadSettings = mergeSettingsSources(existing?.loadSettings, incoming?.loadSettings);
    const env = { ...(existing?.env ?? {}) };

    for (const entry of incoming?.envVars ?? []) {
      const key = entry.key.trim();
      if (!key) {
        continue;
      }
      env[key] = entry.value;
    }

    const previousElastic = existing?.elasticsearch;
    const nextElasticInput = incoming?.elasticsearch;
    const elasticsearch: ResolvedRuntimeConfig["elasticsearch"] = {
      enabled: nextElasticInput?.enabled ?? previousElastic?.enabled ?? true,
      endpoint:
        nextElasticInput?.endpoint?.trim() ||
        previousElastic?.endpoint ||
        DEFAULT_ES_ENDPOINT,
      apiKey: nextElasticInput?.apiKey ?? previousElastic?.apiKey,
      bearerToken: nextElasticInput?.bearerToken ?? previousElastic?.bearerToken,
      username:
        nextElasticInput?.username?.trim() ||
        previousElastic?.username ||
        undefined,
      password: nextElasticInput?.password ?? previousElastic?.password,
      headersJson:
        sanitizeHeadersJson(nextElasticInput?.headersJson) ??
        previousElastic?.headersJson,
    };

    return {
      // Claude always runs in the server workspace. Requests can no longer override it.
      cwd: WORKSPACE_ROOT,
      additionalDirectories:
        incoming?.additionalDirectories?.map((item) => item.trim()).filter(Boolean) ??
        existing?.additionalDirectories ??
        [],
      model: incoming?.model?.trim() || existing?.model,
      permissionMode: incoming?.permissionMode ?? existing?.permissionMode ?? "bypassPermissions",
      effort: incoming?.effort ?? existing?.effort ?? "medium",
      maxTurns: incoming?.maxTurns ?? existing?.maxTurns,
      systemPromptAppend:
        incoming?.systemPromptAppend?.trim() || existing?.systemPromptAppend,
      debug: incoming?.debug ?? existing?.debug ?? false,
      strictMcpConfig: incoming?.strictMcpConfig ?? existing?.strictMcpConfig ?? false,
      loadSettings,
      env,
      allowedTools: resolveStringArray(
        incoming?.allowedTools,
        existing?.allowedTools,
        ["mcp__elasticsearch__*"],
      ),
      disallowedTools: resolveStringArray(
        incoming?.disallowedTools,
        existing?.disallowedTools,
        [],
      ),
      elasticsearch,
    };
  }

  private sanitizeRuntimeConfig(runtime: ResolvedRuntimeConfig): SanitizedTaskRuntimeConfig {
    return {
      cwd: runtime.cwd,
      additionalDirectories: runtime.additionalDirectories,
      model: runtime.model,
      permissionMode: runtime.permissionMode,
      effort: runtime.effort,
      maxTurns: runtime.maxTurns,
      systemPromptAppend: runtime.systemPromptAppend,
      debug: runtime.debug,
      strictMcpConfig: runtime.strictMcpConfig,
      loadSettings: runtime.loadSettings,
      envKeys: Object.keys(runtime.env).sort(),
      allowedTools: runtime.allowedTools,
      disallowedTools: runtime.disallowedTools,
      elasticsearch: {
        enabled: runtime.elasticsearch.enabled,
        endpoint: runtime.elasticsearch.endpoint,
        hasApiKey: Boolean(runtime.elasticsearch.apiKey),
        hasBearerToken: Boolean(runtime.elasticsearch.bearerToken),
        username: runtime.elasticsearch.username,
        hasPassword: Boolean(runtime.elasticsearch.password),
        hasHeadersJson: Boolean(runtime.elasticsearch.headersJson),
      },
    };
  }

  private async appendLog(
    task: ClaudeTaskSnapshot,
    kind: TaskLogEntry["kind"],
    text?: string,
    payload?: unknown,
  ) {
    const entry: TaskLogEntry = {
      id: randomUUID(),
      kind,
      createdAt: isoNow(),
      text,
      payload,
    };

    task.logs.push(entry);
    task.updatedAt = entry.createdAt;
    await this.store.save(task);
    this.emit({ type: "log", taskId: task.id, entry });
    this.emit({ type: "task.updated", task });
  }

  private async setTaskError(task: ClaudeTaskSnapshot, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    task.status = "error";
    task.lastError = message;
    task.pendingRequest = undefined;
    task.updatedAt = isoNow();
    await this.appendLog(task, "error", message);
    this.emit({
      type: "error",
      taskId: task.id,
      message,
      createdAt: isoNow(),
    });
  }

  private async runTurn(taskId: string, prompt: string) {
    const task = this.requireTask(taskId);
    const live = this.ensureLive(taskId);

    if (live.abortController) {
      return;
    }

    const abortController = new AbortController();
    live.abortController = abortController;
    live.partialAssistantText = "";
    task.status = "running";
    task.lastError = undefined;
    task.pendingRequest = undefined;
    task.result = undefined;
    task.currentTurn += 1;
    task.updatedAt = isoNow();
    task.config = this.sanitizeRuntimeConfig(live.runtime);
    await this.store.save(task);
    this.emit({ type: "task.updated", task });

    try {
      const options = this.buildQueryOptions(task, live);
      const sdk = await loadClaudeSdk();
      const runner = sdk.query({
        prompt,
        options,
      });
      live.activeQuery = runner;

      for await (const message of runner) {
        await this.handleSdkMessage(task, live, message);
      }

      if (task.status === "running") {
        task.status = "completed";
        task.updatedAt = isoNow();
        await this.store.save(task);
        this.emit({ type: "task.updated", task });
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        task.status = "interrupted";
        task.lastError = task.lastError || "Interrupted by the web operator.";
        task.updatedAt = isoNow();
        await this.store.save(task);
        this.emit({ type: "task.updated", task });
      } else {
        await this.setTaskError(task, error);
      }
    } finally {
      live.abortController = undefined;
      live.activeQuery = undefined;
      live.partialAssistantText = "";
      live.pendingPermission = undefined;
      task.pendingRequest = undefined;
      await this.store.save(task);
      this.emit({ type: "task.updated", task });
    }
  }

  private buildQueryOptions(task: ClaudeTaskSnapshot, live: LiveTaskState) {
    const runtime = live.runtime;
    const env: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(process.env)
          .filter((entry): entry is [string, string] => typeof entry[1] === "string")
          .map(([key, value]) => [key, value]),
      ),
      ...runtime.env,
      CLAUDE_AGENT_SDK_CLIENT_APP: "justsoc-claude-code-bridge",
    };

    const settingSources = buildSettingSources(runtime.loadSettings);
    const mcpServers: Record<string, McpServerConfig> = {};

    if (runtime.elasticsearch.enabled) {
      const esEnv: Record<string, string> = {
        SELK_ES_ENDPOINT: runtime.elasticsearch.endpoint || DEFAULT_ES_ENDPOINT,
      };
      if (runtime.elasticsearch.apiKey) esEnv.ES_API_KEY = runtime.elasticsearch.apiKey;
      if (runtime.elasticsearch.bearerToken) {
        esEnv.ES_BEARER_TOKEN = runtime.elasticsearch.bearerToken;
      }
      if (runtime.elasticsearch.username) esEnv.ES_USERNAME = runtime.elasticsearch.username;
      if (runtime.elasticsearch.password) esEnv.ES_PASSWORD = runtime.elasticsearch.password;
      if (runtime.elasticsearch.headersJson) {
        parseHeadersJson(runtime.elasticsearch.headersJson);
        esEnv.ES_HEADERS_JSON = runtime.elasticsearch.headersJson;
      }

      mcpServers.elasticsearch = {
        command: "node",
        args: [ES_MCP_SCRIPT],
        env: esEnv,
      };
    }

    return {
      abortController: live.abortController,
      additionalDirectories: runtime.additionalDirectories,
      allowDangerouslySkipPermissions: runtime.permissionMode === "bypassPermissions",
      allowedTools: runtime.allowedTools,
      canUseTool: async (
        toolName: string,
        input: Record<string, unknown>,
        context: {
          signal: AbortSignal;
          suggestions?: PermissionUpdate[];
          blockedPath?: string;
          decisionReason?: string;
          toolUseID: string;
        },
      ) => {
        const request: PendingRequestSnapshot = {
          requestId: randomUUID(),
          mode: isQuestionRequest(toolName) ? "question" : ("approval" as PendingRequestMode),
          toolName,
          toolUseId: context.toolUseID,
          createdAt: isoNow(),
          decisionReason: context.decisionReason,
          blockedPath: context.blockedPath,
          input,
          suggestionsAvailable: Boolean(context.suggestions?.length),
        };

        task.pendingRequest = request;
        task.status = "waiting_input";
        await this.appendLog(task, "permission_request", `${toolName} needs input`, request);
        await this.store.save(task);
        this.emit({ type: "task.updated", task });

        const deferred = createDeferredPermission(request, context.suggestions);
        live.pendingPermission = deferred;

        context.signal.addEventListener(
          "abort",
          () => {
            deferred.reject(new Error("Claude run aborted."));
          },
          { once: true },
        );

        try {
          const result = await deferred.promise;
          task.pendingRequest = undefined;
          task.status = "running";
          task.updatedAt = isoNow();
          await this.store.save(task);
          this.emit({ type: "task.updated", task });
          return result;
        } finally {
          live.pendingPermission = undefined;
        }
      },
      cwd: runtime.cwd,
      disallowedTools: runtime.disallowedTools,
      effort: runtime.effort,
      env,
      includePartialMessages: true,
      maxTurns: runtime.maxTurns,
      mcpServers,
      model: runtime.model,
      permissionMode: runtime.permissionMode,
      persistSession: true,
      ...(task.currentTurn > 1
        ? { resume: task.sdkSession.sessionId }
        : { sessionId: task.sdkSession.sessionId }),
      ...(settingSources.length ? { settingSources } : {}),
      stderr: (data: string) => {
        const trimmed = data.trim();
        if (!trimmed) {
          return;
        }
        void this.appendLog(task, "stderr", trimmed);
      },
      strictMcpConfig: runtime.strictMcpConfig,
      systemPrompt: {
        type: "preset" as const,
        preset: "claude_code" as const,
        ...(runtime.systemPromptAppend
          ? { append: runtime.systemPromptAppend }
          : {}),
      },
      tools: {
        type: "preset" as const,
        preset: "claude_code" as const,
      },
    };
  }

  private async handleSdkMessage(
    task: ClaudeTaskSnapshot,
    live: LiveTaskState,
    message: SDKMessage,
  ) {
    switch (message.type) {
      case "assistant":
        await this.handleAssistantMessage(task, message);
        return;
      case "stream_event":
        await this.handlePartialAssistant(task, live, message);
        return;
      case "system":
        await this.handleSystemMessage(task, message);
        return;
      case "tool_progress":
        await this.handleToolProgress(task, message);
        return;
      case "auth_status":
        await this.handleAuthStatus(task, message);
        return;
      case "result":
        await this.handleResult(task, message);
        return;
      case "user":
        return;
      default:
        await this.appendLog(
          task,
          "system",
          "Unhandled SDK message variant received.",
          message,
        );
    }
  }

  private async handleAssistantMessage(
    task: ClaudeTaskSnapshot,
    message: SDKAssistantMessage,
  ) {
    const content = extractTextFromMessageContent(message.message.content);
    if (!content) {
      return;
    }
    await this.appendLog(task, "assistant_message", content, message);
  }

  private async handlePartialAssistant(
    task: ClaudeTaskSnapshot,
    live: LiveTaskState,
    message: SDKPartialAssistantMessage,
  ) {
    const chunk = extractTextDelta(message);
    if (!chunk) {
      return;
    }
    live.partialAssistantText += chunk;
    this.emit({
      type: "assistant.partial",
      taskId: task.id,
      chunk,
      createdAt: isoNow(),
    });
  }

  private async handleSystemMessage(
    task: ClaudeTaskSnapshot,
    message: SDKSystemMessage,
  ) {
    const record = message as Record<string, unknown>;

    task.sdkSession.claudeCodeVersion =
      asString(record.claude_code_version) ??
      asString(record.version) ??
      task.sdkSession.claudeCodeVersion;
    task.sdkSession.model =
      asString(record.model) ?? task.sdkSession.model;
    task.sdkSession.permissionMode =
      asString(record.permissionMode) ??
      asString(record.permission_mode) ??
      task.sdkSession.permissionMode;

    const tools =
      asStringArray(record.tools) ??
      asStringArray(record.available_tools) ??
      task.sdkSession.availableTools;
    if (tools) {
      task.sdkSession.availableTools = tools;
    }

    if (Array.isArray(record.mcp_servers)) {
      task.sdkSession.mcpServers = record.mcp_servers
        .map((item) => asObject(item))
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .map((item) => ({
          name: asString(item.name),
          status: asString(item.status),
        }));
    }

    await this.appendLog(task, "system", `SDK system message: ${message.subtype}`, message);
  }

  private async handleToolProgress(
    task: ClaudeTaskSnapshot,
    message: SDKToolProgressMessage,
  ) {
    await this.appendLog(
      task,
      "tool_progress",
      `${message.tool_name} running for ${message.elapsed_time_seconds.toFixed(1)}s`,
      message,
    );
  }

  private async handleAuthStatus(
    task: ClaudeTaskSnapshot,
    message: SDKAuthStatusMessage,
  ) {
    const summary =
      message.output.filter(Boolean).join("\n").trim() ||
      (message.isAuthenticating ? "Authentication in progress." : "Authentication status updated.");
    await this.appendLog(task, "auth_status", summary, message);
  }

  private async handleResult(
    task: ClaudeTaskSnapshot,
    message: SDKResultMessage,
  ) {
    task.result = {
      subtype: message.subtype,
      text: message.result,
      errors: message.errors,
      totalCostUsd: message.total_cost_usd,
      durationMs: message.duration_ms,
      numTurns: message.num_turns,
      stopReason: message.stop_reason,
      permissionDenials: message.permission_denials?.map((item) => ({
        toolName: item.tool_name,
        toolUseId: item.tool_use_id,
        toolInput: item.tool_input,
      })),
    };
    task.status = message.is_error ? "error" : "completed";
    task.lastError = message.is_error
      ? message.errors?.join("; ") || message.result || "Claude reported an error."
      : undefined;
    task.updatedAt = isoNow();
    await this.appendLog(task, "task_result", message.result || message.subtype, message);
  }
}
