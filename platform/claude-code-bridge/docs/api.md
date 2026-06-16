# Claude Code Bridge API

## Overview

Base URL:

```text
http://0.0.0.0:4317
```

This service is API-first. The web page under `/` is only a functional demo for these APIs.

Transport rules:

- All non-streaming APIs use `application/json; charset=utf-8`
- All timestamps are ISO-8601 strings
- Success responses return `200` or `201`
- Errors return:

```json
{
  "error": true,
  "message": "..."
}
```

## Task Lifecycle

Task status values:

- `idle`: task created, run not started yet
- `running`: Claude Code is currently executing
- `waiting_input`: waiting for a tool approval or `AskUserQuestion` response
- `completed`: run finished successfully
- `error`: run failed
- `interrupted`: run was manually interrupted or broken by restart

Typical flow:

1. `POST /api/tasks` creates a task and starts the first run.
2. `GET /api/tasks/:taskId/events` subscribes to live output.
3. If Claude asks for approval or input, the task enters `waiting_input`.
4. `POST /api/tasks/:taskId/decision` resumes the run.
5. `POST /api/tasks/:taskId/messages` continues the same Claude session with a new user message.

## Core Objects

### `TaskRuntimeConfigInput`

Request-side runtime config:

```json
{
  "additionalDirectories": [
    "C:\\tmp"
  ],
  "model": "claude-opus-4-1",
  "permissionMode": "default",
  "effort": "medium",
  "maxTurns": 8,
  "systemPromptAppend": "Always explain the patch before editing.",
  "debug": false,
  "strictMcpConfig": false,
  "loadSettings": {
    "user": true,
    "project": true,
    "local": true
  },
  "envVars": [
    { "key": "ANTHROPIC_API_KEY", "value": "..." }
  ],
  "allowedTools": [
    "mcp__elasticsearch__*"
  ],
  "disallowedTools": [],
  "elasticsearch": {
    "enabled": true,
    "endpoint": "http://elasticsearch:9200",
    "apiKey": "...",
    "bearerToken": "...",
    "username": "elastic",
    "password": "...",
    "headersJson": "{\"x-found-cluster\":\"example\"}"
  }
}
```

Notes:

- The Claude workspace is fixed to the server process `./workspace` directory and cannot be overridden per request.
- `envVars` are injected into the Claude Code runtime.
- Returned task snapshots do not echo secret values. They only expose sanitized flags such as `envKeys`, `hasApiKey`, `hasPassword`.
- `permissionMode` is passed through to the Claude Agent SDK.
- If `elasticsearch.enabled` is `true`, the server mounts `./workspace/scripts/es-mcp-server.mjs`.
- The default Elasticsearch endpoint is read from `./workspace/.claude/.mcp.json` when that file defines `SELK_ES_ENDPOINT`.
- Request-side `config.elasticsearch` values are task-scoped runtime overrides. They do not get written back to `./workspace/.claude/.mcp.json`.
- Secret `config.elasticsearch` values such as API keys, bearer tokens, passwords, and custom headers are passed to the MCP child process via environment variables, not persisted in clear text, and not restored after a server restart.

Config sources and configurable fields:

- Fixed by the server:
  - `cwd`: always `./workspace`
- Project-level defaults under `./workspace`:
  - `./workspace/.claude/.mcp.json`: default `SELK_ES_ENDPOINT` for the built-in Elasticsearch MCP
  - `./workspace/.claude/settings.local.json`: Claude Code project-local settings used when `loadSettings.local` is enabled
- Request-side runtime config in `config`:
  - `additionalDirectories`: extra readable/writable directories for the run
  - `model`: Claude model override
  - `permissionMode`: SDK permission mode such as `default` or `bypassPermissions`
  - `effort`: reasoning effort
  - `maxTurns`: maximum turns for the run
  - `systemPromptAppend`: extra system prompt suffix
  - `debug`: runtime debug flag
  - `strictMcpConfig`: strict MCP validation mode
  - `loadSettings.user|project|local`: whether Claude should load user/project/local settings sources
  - `envVars`: per-task runtime environment variables injected into Claude
  - `allowedTools` / `disallowedTools`: tool allow/deny filters for the run
  - `elasticsearch.enabled`: enable or disable the built-in Elasticsearch MCP for the task
  - `elasticsearch.endpoint`: task-scoped endpoint override
  - `elasticsearch.apiKey|bearerToken|username|password|headersJson`: task-scoped MCP auth and header overrides

Persistence behavior:

- Persisted in task snapshots:
  - `model`, `permissionMode`, `effort`, `maxTurns`, `systemPromptAppend`, `debug`, `strictMcpConfig`
  - `loadSettings`
  - `allowedTools` / `disallowedTools`
  - `elasticsearch.enabled`, `elasticsearch.endpoint`, `elasticsearch.username`
  - secret presence flags such as `hasApiKey`, `hasPassword`, `hasBearerToken`, `hasHeadersJson`
- Not persisted in clear text:
  - `envVars` values
  - `elasticsearch.apiKey`, `elasticsearch.bearerToken`, `elasticsearch.password`, `elasticsearch.headersJson`

### `ClaudeTaskSnapshot`

Main task object returned by most endpoints:

```json
{
  "id": "uuid",
  "title": "Check platform API routes",
  "status": "running",
  "createdAt": "2026-05-15T07:27:12.551Z",
  "updatedAt": "2026-05-15T07:27:12.556Z",
  "currentTurn": 1,
  "lastError": "optional",
  "config": {
    "cwd": "<current-working-directory>\\workspace",
    "additionalDirectories": [],
    "model": "optional",
    "permissionMode": "default",
    "effort": "medium",
    "maxTurns": 8,
    "systemPromptAppend": "optional",
    "debug": false,
    "strictMcpConfig": false,
    "loadSettings": {
      "user": true,
      "project": true,
      "local": true
    },
    "envKeys": [
      "ANTHROPIC_API_KEY"
    ],
    "allowedTools": [
      "mcp__elasticsearch__*"
    ],
    "disallowedTools": [],
    "elasticsearch": {
      "enabled": true,
      "endpoint": "http://elasticsearch:9200",
      "hasApiKey": true,
      "hasBearerToken": false,
      "username": "elastic",
      "hasPassword": true,
      "hasHeadersJson": false
    }
  },
  "logs": [],
  "pendingRequest": {
    "requestId": "uuid",
    "mode": "approval",
    "toolName": "Edit",
    "toolUseId": "toolu_...",
    "createdAt": "2026-05-15T07:28:10.100Z",
    "decisionReason": "Optional reason from SDK",
    "blockedPath": "Optional blocked path",
    "input": {},
    "suggestionsAvailable": true
  },
  "sdkSession": {
    "sessionId": "uuid",
    "claudeCodeVersion": "optional",
    "model": "optional",
    "permissionMode": "optional",
    "availableTools": [],
    "mcpServers": [
      {
        "name": "elasticsearch",
        "status": "connected"
      }
    ]
  },
  "result": {
    "subtype": "completed",
    "text": "optional final summary",
    "errors": [],
    "totalCostUsd": 0.01,
    "durationMs": 12000,
    "numTurns": 2,
    "stopReason": "end_turn",
    "permissionDenials": []
  }
}
```

### `TaskLogEntry`

Log kinds:

- `user_message`
- `assistant_message`
- `system`
- `task_result`
- `tool_progress`
- `permission_request`
- `auth_status`
- `stderr`
- `error`

Shape:

```json
{
  "id": "uuid",
  "kind": "assistant_message",
  "createdAt": "2026-05-15T07:29:00.000Z",
  "text": "message text",
  "payload": {}
}
```

## REST API

### `GET /api/health`

Health check.

Response:

