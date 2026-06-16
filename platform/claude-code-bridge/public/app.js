const state = {
  defaults: null,
  tasks: [],
  selectedTask: null,
  sessionInfo: null,
  eventSource: null,
  partialAssistantText: "",
};

const elements = {
  taskForm: document.querySelector("#task-form"),
  taskTitle: document.querySelector("#task-title"),
  taskPrompt: document.querySelector("#task-prompt"),
  taskAdditionalDirectories: document.querySelector("#task-additional-directories"),
  taskModel: document.querySelector("#task-model"),
  taskPermissionMode: document.querySelector("#task-permission-mode"),
  taskEffort: document.querySelector("#task-effort"),
  taskMaxTurns: document.querySelector("#task-max-turns"),
  taskSystemPrompt: document.querySelector("#task-system-prompt"),
  settingUser: document.querySelector("#setting-user"),
  settingProject: document.querySelector("#setting-project"),
  settingLocal: document.querySelector("#setting-local"),
  taskStrictMcp: document.querySelector("#task-strict-mcp"),
  envList: document.querySelector("#env-list"),
  addEnvButton: document.querySelector("#add-env-button"),
  resetFormButton: document.querySelector("#reset-form-button"),
  taskAllowedTools: document.querySelector("#task-allowed-tools"),
  taskDisallowedTools: document.querySelector("#task-disallowed-tools"),
  esEnabled: document.querySelector("#es-enabled"),
  esEndpoint: document.querySelector("#es-endpoint"),
  esApiKey: document.querySelector("#es-api-key"),
  esBearerToken: document.querySelector("#es-bearer-token"),
  esUsername: document.querySelector("#es-username"),
  esPassword: document.querySelector("#es-password"),
  esHeadersJson: document.querySelector("#es-headers-json"),
  formStatus: document.querySelector("#form-status"),
  taskList: document.querySelector("#task-list"),
  refreshTasksButton: document.querySelector("#refresh-tasks-button"),
  selectedTaskTitle: document.querySelector("#selected-task-title"),
  selectedTaskSubtitle: document.querySelector("#selected-task-subtitle"),
  selectedTaskStatus: document.querySelector("#selected-task-status"),
  selectedTaskMeta: document.querySelector("#selected-task-meta"),
  transcript: document.querySelector("#transcript"),
  interruptTaskButton: document.querySelector("#interrupt-task-button"),
  pendingRequest: document.querySelector("#pending-request"),
  messageForm: document.querySelector("#message-form"),
  messageContent: document.querySelector("#message-content"),
  messageStatus: document.querySelector("#message-status"),
  sendMessageButton: document.querySelector("#send-message-button"),
  sessionInfo: document.querySelector("#session-info"),
  reloadSessionInfoButton: document.querySelector("#reload-session-info-button"),
  envTemplate: document.querySelector("#env-row-template"),
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatTime(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function setStatusText(element, text, isError = false) {
  element.textContent = text || "";
  element.style.color = isError ? "var(--danger)" : "var(--text-muted)";
}

function parseCommaSeparated(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function createEnvRow(key = "", value = "") {
  const fragment = elements.envTemplate.content.cloneNode(true);
  const row = fragment.querySelector(".env-row");
  row.querySelector(".env-key").value = key;
  row.querySelector(".env-value").value = value;
  row.querySelector(".remove-env-button").addEventListener("click", () => {
    row.remove();
  });
  elements.envList.appendChild(fragment);
}

function clearEnvRows() {
  elements.envList.innerHTML = "";
}

function resetForm() {
  elements.taskTitle.value = "";
  elements.taskPrompt.value = "";
  elements.taskModel.value = "";
  elements.taskPermissionMode.value = "bypassPermissions";
  elements.taskEffort.value = "medium";
  elements.taskMaxTurns.value = "";
  elements.taskSystemPrompt.value = "";
  elements.settingUser.checked = true;
  elements.settingProject.checked = true;
  elements.settingLocal.checked = true;
  elements.taskStrictMcp.checked = false;
  elements.taskAllowedTools.value = "mcp__elasticsearch__*";
  elements.taskDisallowedTools.value = "";
  elements.esEnabled.checked = true;
  elements.esApiKey.value = "";
  elements.esBearerToken.value = "";
  elements.esUsername.value = "";
  elements.esPassword.value = "";
  elements.esHeadersJson.value = "";
  clearEnvRows();
  createEnvRow();
  if (state.defaults) {
    elements.esEndpoint.value = state.defaults.defaultElasticsearchEndpoint || "";
  }
}

function collectEnvVars() {
  return [...elements.envList.querySelectorAll(".env-row")]
    .map((row) => ({
      key: row.querySelector(".env-key").value.trim(),
      value: row.querySelector(".env-value").value,
    }))
    .filter((item) => item.key);
}

function collectRuntimeConfig() {
  const maxTurnsValue = Number(elements.taskMaxTurns.value);
  return {
    additionalDirectories: parseCommaSeparated(elements.taskAdditionalDirectories.value.trim()),
    model: elements.taskModel.value.trim() || undefined,
    permissionMode: elements.taskPermissionMode.value,
    effort: elements.taskEffort.value,
    maxTurns:
      elements.taskMaxTurns.value.trim() && Number.isFinite(maxTurnsValue)
        ? maxTurnsValue
        : undefined,
    systemPromptAppend: elements.taskSystemPrompt.value.trim() || undefined,
    strictMcpConfig: elements.taskStrictMcp.checked,
    loadSettings: {
      user: elements.settingUser.checked,
      project: elements.settingProject.checked,
      local: elements.settingLocal.checked,
    },
    envVars: collectEnvVars(),
    allowedTools: parseCommaSeparated(elements.taskAllowedTools.value),
    disallowedTools: parseCommaSeparated(elements.taskDisallowedTools.value),
    elasticsearch: {
      enabled: elements.esEnabled.checked,
      endpoint: elements.esEndpoint.value.trim() || undefined,
      apiKey: elements.esApiKey.value || undefined,
      bearerToken: elements.esBearerToken.value || undefined,
      username: elements.esUsername.value.trim() || undefined,
      password: elements.esPassword.value || undefined,
      headersJson: elements.esHeadersJson.value.trim() || undefined,
    },
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message || "Request failed.");
  }
  return payload;
}

function upsertTask(task) {
  const index = state.tasks.findIndex((item) => item.id === task.id);
  if (index >= 0) {
    state.tasks[index] = task;
  } else {
    state.tasks.unshift(task);
  }
  state.tasks.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function renderTaskList() {
  if (!state.tasks.length) {
    elements.taskList.innerHTML = '<div class="empty-state">杩樻病鏈変换鍔★紝鍏堝湪涓婇潰鍒涘缓涓€涓€?/div>';
    return;
  }

  const container = document.createDocumentFragment();
  for (const task of state.tasks) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `task-card${state.selectedTask?.id === task.id ? " active" : ""}`;
    button.addEventListener("click", () => {
      selectTask(task.id);
    });

    const title = document.createElement("div");
    title.className = "task-card-title";
    title.textContent = task.title;

    const meta = document.createElement("div");
    meta.className = "task-card-meta";
    meta.innerHTML = `
      <span class="status-badge status-${escapeHtml(task.status)}">${escapeHtml(task.status)}</span>
      <span>${escapeHtml(formatTime(task.updatedAt))}</span>
      <span>${escapeHtml(task.config.cwd)}</span>
      <span>turn ${escapeHtml(task.currentTurn)}</span>
    `;

    button.append(title, meta);
    container.appendChild(button);
  }

  elements.taskList.innerHTML = "";
  elements.taskList.appendChild(container);
}

function createMetaCard(label, value) {
  const card = document.createElement("div");
  card.className = "meta-card";
  const labelNode = document.createElement("span");
