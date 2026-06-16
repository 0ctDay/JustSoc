'use client';

import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import DispatcherTargetSettings from '@/components/DispatcherTargetSettings';
import SectionCard from '@/components/SectionCard';
import StatusPanel from '@/components/StatusPanel';
import { defaultAlertFieldMappings, type AlertFieldMappings, type AlertFieldMappingSchemaItem } from '@/lib/alert-field-mapping-schema';
import {
  CLAUDE_CODE_BRIDGE_EFFORTS,
  CLAUDE_CODE_BRIDGE_PERMISSION_MODES,
  CLAUDE_CODE_BRIDGE_REQUIRED_ENV_KEYS,
  type ClaudeBridgeTaskLogEntry,
  type ClaudeBridgeTaskSnapshot,
  defaultClaudeCodeBridgeSettings,
  getMissingClaudeCodeBridgeRequiredEnvKeys,
  parseLineList,
  resolveClaudeCodeBridgeEnvVars,
  type ClaudeCodeBridgeSettings,
} from '@/lib/claude-code-bridge-config';

type RuntimeMonitorSettings = {
  aiBaseUrl: string;
  aiApiKey: string;
  aiModel: string;
  aggregationWindowMinutes: number;
};

type AlertFieldMappingsResponse = {
  mappings: AlertFieldMappings;
  schema: AlertFieldMappingSchemaItem[];
  configPath: string;
};

type BridgeHealthResponse = {
  ok?: boolean;
  service?: string;
  port?: number;
};

type BridgeTaskResponse = {
  task: ClaudeBridgeTaskSnapshot;
};

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message ?? '请求失败');
  }
  return payload as T;
}

function createEmptyMappings(): AlertFieldMappings {
  return { ...defaultAlertFieldMappings };
}

const BRIDGE_WORKSPACE_ROOT = 'claude-code-bridge/workspace';
const BRIDGE_HEALTHCHECK_PROMPT = '请只回复一行精确文本：Helloworld。不要调用任何工具，不要修改文件，不要输出其他说明。';
const BRIDGE_HEALTHCHECK_EXPECTED_REPLY = 'Helloworld';
const ES_MCP_INITIALIZATION_PROMPT = [
  '请测试当前会话中的 Elasticsearch MCP 连接状态，并完成一次最小影响的只读自检。',
  '',
  '要求：',
  '1. 先确认 Elasticsearch MCP 是否已经挂载，以及当前可用的 MCP 工具状态。',
  '2. 尝试执行最小影响、只读的连通性检查，例如 cluster info、cluster health、ping 或等价只读能力。',
  '3. 如果无法连接，请明确说明失败发生在哪一层：未挂载、endpoint 配置错误、认证失败、网络不可达、headers 不正确，或其他原因。',
  '4. 如果问题可以在当前工作区、当前会话或当前配置内自行修复，请先尝试修复，再重新验证一次。',
  '5. 可以检查与 bridge 相关的配置来源，例如 runtime config、workspace/.claude/.mcp.json、环境变量、ES endpoint 和认证配置。',
  '6. 不要进行破坏性操作，不要修改与 Elasticsearch MCP 无关的文件。',
  '7. 最终请按下面结构输出：连接是否成功、实际使用的 endpoint、已执行的检查、发现的问题、已尝试的修复、后续建议。',
].join('\n');
const ES_MCP_INITIALIZATION_PROMPT_SHORT = [
  '请测试当前会话中的 Elasticsearch MCP 连接状态。',
  '只需要完成两件事：',
  '1. 确定 ES 是否可以正常连通。',
  '2. 如果不能联通，先尝试自行解决，再说明最终结果和原因。',
].join('\n');

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractBridgeTaskReply(task: ClaudeBridgeTaskSnapshot) {
  const assistantEntries = task.logs.filter((entry): entry is ClaudeBridgeTaskLogEntry => entry.kind === 'assistant_message');
  const latestAssistantText = assistantEntries.at(-1)?.text?.trim();
  const resultText = task.result?.text?.trim();
  return latestAssistantText || resultText || '';
}

function normalizeBridgeHealthCheckReply(value: string) {
  return value
    .trim()
    .replace(/^[\s"'`“”‘’]+|[\s"'`“”‘’]+$/gu, '')
    .replace(/[。．｡.!！？?]+$/gu, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

async function waitForBridgeTaskCompletion(taskId: string, timeoutMs = 45000, pollMs = 1500) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const payload = await fetchJson<BridgeTaskResponse>(`/api/claude-bridge/tasks/${encodeURIComponent(taskId)}`);
    const task = payload.task;

    if (task.status === 'completed' || task.status === 'error' || task.status === 'interrupted' || task.status === 'waiting_input') {
      return task;
    }

    await sleep(pollMs);
  }

  throw new Error('Claude Code Bridge HelloWorld 检查超时，请稍后重试。');
}

export default function SettingsPage() {
  const [aiBaseUrl, setAiBaseUrl] = useState('');
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiModel, setAiModel] = useState('gpt-4o-mini');
  const [aggregationWindowMinutes, setAggregationWindowMinutes] = useState(20);

  const [fieldMappings, setFieldMappings] = useState<AlertFieldMappings>(createEmptyMappings);
  const [fieldMappingSchema, setFieldMappingSchema] = useState<AlertFieldMappingSchemaItem[]>([]);
  const [fieldMappingsPath, setFieldMappingsPath] = useState('');
  const [fieldMappingsModalOpen, setFieldMappingsModalOpen] = useState(false);

  const [bridgeSettings, setBridgeSettings] = useState<ClaudeCodeBridgeSettings>(() => defaultClaudeCodeBridgeSettings());
  const [bridgeModalOpen, setBridgeModalOpen] = useState(false);
  const [bridgeHealthMessage, setBridgeHealthMessage] = useState('');

  const [loading, setLoading] = useState(true);
  const [savingAi, setSavingAi] = useState(false);
  const [testingAi, setTestingAi] = useState(false);
  const [savingAggregation, setSavingAggregation] = useState(false);
  const [savingBridge, setSavingBridge] = useState(false);
  const [testingBridge, setTestingBridge] = useState(false);
  const [restartingBridge, setRestartingBridge] = useState(false);
  const [initializingBridgeEsMcp, setInitializingBridgeEsMcp] = useState(false);
  const [savingFieldMappings, setSavingFieldMappings] = useState(false);

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [aiTestReply, setAiTestReply] = useState('');

  const bridgeAdditionalDirectories = parseLineList(bridgeSettings.additionalDirectoriesText);
  const bridgeEnvVars = resolveClaudeCodeBridgeEnvVars(bridgeSettings);
  const bridgeAllowedTools = parseLineList(bridgeSettings.allowedToolsText);
  const bridgeDisallowedTools = parseLineList(bridgeSettings.disallowedToolsText);
  const bridgeMissingRequiredEnvKeys = getMissingClaudeCodeBridgeRequiredEnvKeys(bridgeSettings);
  const bridgeSettingSources = [
    bridgeSettings.loadSettingsUser ? 'user' : '',
    bridgeSettings.loadSettingsProject ? 'project' : '',
    bridgeSettings.loadSettingsLocal ? 'local' : '',
  ].filter(Boolean);
  const bridgeElasticsearchLabel = bridgeSettings.elasticsearchEnabled
    ? (bridgeSettings.elasticsearchEndpoint.trim() || '.claude/.mcp.json 默认值')
    : '已禁用';

  useEffect(() => {
    void loadSettings();
  }, []);

  async function loadSettings() {
    try {
      setLoading(true);
      setError('');
      const [runtimeResponse, mappingsResponse, bridgeResponse] = await Promise.all([
        fetchJson<{ settings: RuntimeMonitorSettings }>('/api/settings/runtime-monitor'),
        fetchJson<AlertFieldMappingsResponse>('/api/settings/alert-field-mappings'),
        fetchJson<{ settings: ClaudeCodeBridgeSettings }>('/api/settings/claude-code-bridge'),
      ]);

      setAiBaseUrl(runtimeResponse.settings.aiBaseUrl ?? '');
      setAiApiKey(runtimeResponse.settings.aiApiKey ?? '');
      setAiModel(runtimeResponse.settings.aiModel ?? 'gpt-4o-mini');
      setAggregationWindowMinutes(runtimeResponse.settings.aggregationWindowMinutes ?? 20);

      setFieldMappings(mappingsResponse.mappings);
      setFieldMappingSchema(mappingsResponse.schema);
      setFieldMappingsPath(mappingsResponse.configPath);

      setBridgeSettings(bridgeResponse.settings);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载配置失败');
    } finally {
      setLoading(false);
    }
  }

  async function saveRuntimeSettings(successMessage: string) {
    const response = await fetchJson<{ settings: RuntimeMonitorSettings }>('/api/settings/runtime-monitor', {
      method: 'PUT',
      body: JSON.stringify({
        aiBaseUrl,
        aiApiKey,
        aiModel,
        aggregationWindowMinutes,
      }),
    });

    setAiBaseUrl(response.settings.aiBaseUrl ?? '');
    setAiApiKey(response.settings.aiApiKey ?? '');
    setAiModel(response.settings.aiModel ?? 'gpt-4o-mini');
    setAggregationWindowMinutes(response.settings.aggregationWindowMinutes ?? 20);
    setSuccess(successMessage);
  }

  function restoreFieldMappingDefaults() {
    setFieldMappings(
      fieldMappingSchema.reduce<AlertFieldMappings>((current, item) => {
        current[item.key] = item.defaultValue;
        return current;
      }, createEmptyMappings()),
    );
  }

  function updateBridgeSettings<K extends keyof ClaudeCodeBridgeSettings>(key: K, value: ClaudeCodeBridgeSettings[K]) {
    setBridgeSettings((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function handleAiSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setSavingAi(true);
      setError('');
      setSuccess('');
      setAiTestReply('');
      await saveRuntimeSettings('AI 配置已保存。');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存 AI 配置失败');
    } finally {
      setSavingAi(false);
    }
  }

  async function handleAiTest() {
    try {
      setTestingAi(true);
      setError('');
      setSuccess('');
      setAiTestReply('');
      const response = await fetchJson<{ reply: string }>('/api/ai/test', {
        method: 'POST',
        body: JSON.stringify({ aiBaseUrl, aiApiKey, aiModel }),
      });
      setAiTestReply(response.reply);
      setSuccess('AI Hello World 测试成功。');
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : 'AI 测试失败');
    } finally {
      setTestingAi(false);
    }
  }

  async function handleAggregationSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setSavingAggregation(true);
      setError('');
      setSuccess('');
      await saveRuntimeSettings('聚合配置已保存。');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存聚合配置失败');
    } finally {
      setSavingAggregation(false);
    }
  }

  async function handleBridgeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setSavingBridge(true);
      setError('');
      setSuccess('');
      setBridgeHealthMessage('');
      const response = await fetchJson<{ settings: ClaudeCodeBridgeSettings }>('/api/settings/claude-code-bridge', {
        method: 'PUT',
        body: JSON.stringify(bridgeSettings),
      });
      setBridgeSettings(response.settings);
      setBridgeModalOpen(false);
      setSuccess('Claude Code Bridge 配置已保存。');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存 Claude Code Bridge 配置失败');
    } finally {
      setSavingBridge(false);
    }
  }

  async function handleBridgeHealthTest() {
    let healthCheckTaskId: string | null = null;
    try {
      setTestingBridge(true);
      setError('');
      setSuccess('');
      setBridgeHealthMessage('');
      const response = await fetchJson<BridgeHealthResponse>('/api/claude-bridge/health');
      const createdTask = await fetchJson<BridgeTaskResponse>('/api/claude-bridge/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Bridge Health Check',
          prompt: BRIDGE_HEALTHCHECK_PROMPT,
        }),
      });

      healthCheckTaskId = createdTask.task.id;
      const completedTask = await waitForBridgeTaskCompletion(createdTask.task.id);

      if (completedTask.status !== 'completed') {
        const detail = completedTask.lastError || extractBridgeTaskReply(completedTask) || 'HelloWorld task did not complete normally.';
        throw new Error(`Bridge 接口已连通，但 HelloWorld 回复检查失败：${detail}`);
      }

      const reply = extractBridgeTaskReply(completedTask);
      if (normalizeBridgeHealthCheckReply(reply) !== normalizeBridgeHealthCheckReply(BRIDGE_HEALTHCHECK_EXPECTED_REPLY)) {
        throw new Error(`Bridge 接口已连通，但 HelloWorld 回复不符合预期。期望 "${BRIDGE_HEALTHCHECK_EXPECTED_REPLY}"，实际收到 "${reply || '(empty)'}"。`);
      }
      setBridgeHealthMessage(`${response.service ?? 'Claude Code Bridge'} 已连通，监听端口 ${response.port ?? '-'}.`);
      setSuccess('Claude Code Bridge 健康检查成功。');
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : 'Claude Code Bridge 健康检查失败');
    } finally {
      if (healthCheckTaskId) {
        try {
          await fetchJson<BridgeTaskResponse>(`/api/claude-bridge/tasks/${encodeURIComponent(healthCheckTaskId)}`, {
            method: 'DELETE',
          });
        } catch {
        }
      }
      setTestingBridge(false);
    }
  }

  async function handleBridgeRestart() {
    try {
      setRestartingBridge(true);
      setError('');
      setSuccess('');
      setBridgeHealthMessage('');
      await fetchJson<{ ok: boolean }>('/api/settings/claude-code-bridge/restart', { method: 'POST' });
      setBridgeHealthMessage('Claude Code Bridge 进程已重启。');
      setSuccess('Claude Code Bridge 已重启。');
    } catch (restartError) {
      setError(restartError instanceof Error ? restartError.message : 'Claude Code Bridge 重启失败');
    } finally {
      setRestartingBridge(false);
    }
  }

  function handleBridgeEsMcpInitialization() {
    try {
      setInitializingBridgeEsMcp(true);
      setError('');
      setSuccess('');
      setBridgeHealthMessage('');

      window.dispatchEvent(new CustomEvent('justsoc-claude-bridge-create-task', {
        detail: {
          title: 'ES MCP 初始化检查',
          prompt: ES_MCP_INITIALIZATION_PROMPT_SHORT,
        },
      }));

      setSuccess('已在 Claude Code Bridge 悬浮聊天窗创建 ES MCP 初始化任务。');
    } catch (launchError) {
      setError(launchError instanceof Error ? launchError.message : '创建 ES MCP 初始化任务失败');
    } finally {
      setInitializingBridgeEsMcp(false);
    }
  }

  async function handleFieldMappingsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setSavingFieldMappings(true);
      setError('');
      setSuccess('');
      const response = await fetchJson<AlertFieldMappingsResponse>('/api/settings/alert-field-mappings', {
        method: 'PUT',
        body: JSON.stringify(fieldMappings),
      });
      setFieldMappings(response.mappings);
      setFieldMappingSchema(response.schema);
      setFieldMappingsPath(response.configPath);
      setFieldMappingsModalOpen(false);
      setSuccess('告警字段映射已保存。');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存告警字段映射失败');
    } finally {
      setSavingFieldMappings(false);
    }
  }

  if (loading) {
    return <StatusPanel title="设置加载中" description="正在读取探针、AI、Claude Code Bridge、聚合和字段映射配置。" />;
  }

  return (
    <section className="page">
      <header className="page-header">
        <h1 className="page-title">设置中心</h1>
        <p className="page-description">统一管理探针、AI 研判、Claude Code Bridge、聚合默认值和告警字段映射。</p>
      </header>

      <DispatcherTargetSettings />

      <SectionCard title="AI 接入" description="使用 OpenAI 兼容 Chat Completions 接口提供告警分析。">
        <form className="settings-form" onSubmit={handleAiSubmit}>
          <label className="settings-field">
            <span className="field-section-title">AI Base URL</span>
            <input className="input" value={aiBaseUrl} onChange={(event) => setAiBaseUrl(event.target.value)} placeholder="https://your-openai-compatible-endpoint/v1" />
          </label>
          <label className="settings-field">
            <span className="field-section-title">AI API Key</span>
            <input className="input" type="password" value={aiApiKey} onChange={(event) => setAiApiKey(event.target.value)} placeholder="sk-..." />
          </label>
          <label className="settings-field">
            <span className="field-section-title">模型</span>
            <input className="input" value={aiModel} onChange={(event) => setAiModel(event.target.value)} placeholder="gpt-4o-mini" />
          </label>
          <div className="toolbar-group">
            <button className="button button-primary" type="submit" disabled={savingAi || testingAi}>{savingAi ? '保存中...' : '保存 AI 配置'}</button>
            <button className="button" type="button" disabled={savingAi || testingAi} onClick={() => void handleAiTest()}>{testingAi ? '测试中...' : '测试 Hello World'}</button>
            <span className="muted">调用 `/chat/completions` 进行连通性检查。</span>
          </div>
          {aiTestReply ? (
            <div className="probe-metric-item">
              <span className="probe-metric-label">测试回复</span>
              <strong className="probe-metric-value">{aiTestReply}</strong>
            </div>
          ) : null}
        </form>
      </SectionCard>

      <SectionCard title="聚合默认值" description="配置默认聚合时间窗口（分钟）。">
        <form className="settings-form" onSubmit={handleAggregationSubmit}>
          <label className="settings-field">
            <span className="field-section-title">默认聚合窗口（分钟）</span>
            <input
              className="input"
              type="number"
              min={1}
              max={1440}
              value={aggregationWindowMinutes}
              onChange={(event) => setAggregationWindowMinutes(Math.max(1, Math.min(1440, Number(event.target.value) || 1)))}
            />
          </label>
          <div className="toolbar-group">
            <button className="button button-primary" type="submit" disabled={savingAggregation}>{savingAggregation ? '保存中...' : '保存聚合配置'}</button>
            <span className="muted">推荐值：20 分钟。</span>
          </div>
        </form>
      </SectionCard>

      <SectionCard
        title="Claude Code Bridge"
        description="悬浮聊天窗会通过同源平台代理创建任务、续聊会话并消费 SSE 输出。"
        actions={<button className="button button-primary" type="button" onClick={() => setBridgeModalOpen(true)}>打开 Bridge 配置</button>}
      >
        <div className="settings-mapping-summary">
          <div className="probe-metric-item">
            <span className="probe-metric-label">固定工作目录</span>
            <strong className="probe-metric-value">{BRIDGE_WORKSPACE_ROOT}</strong>
          </div>
          <div className="probe-metric-item">
            <span className="probe-metric-label">权限 / 思考强度</span>
            <strong className="probe-metric-value">{bridgeSettings.permissionMode} / {bridgeSettings.effort}</strong>
          </div>
          <div className="probe-metric-item">
            <span className="probe-metric-label">最大轮次</span>
            <strong className="probe-metric-value">{bridgeSettings.maxTurns}</strong>
          </div>
          <div className="probe-metric-item">
            <span className="probe-metric-label">目录 / 环境变量</span>
            <strong className="probe-metric-value">{bridgeAdditionalDirectories.length} / {bridgeEnvVars.length}</strong>
          </div>
          <div className="probe-metric-item">
            <span className="probe-metric-label">必填环境变量</span>
            <strong className="probe-metric-value">
              {bridgeMissingRequiredEnvKeys.length
                ? `${CLAUDE_CODE_BRIDGE_REQUIRED_ENV_KEYS.length - bridgeMissingRequiredEnvKeys.length}/${CLAUDE_CODE_BRIDGE_REQUIRED_ENV_KEYS.length}`
                : `已配置 ${CLAUDE_CODE_BRIDGE_REQUIRED_ENV_KEYS.length}/${CLAUDE_CODE_BRIDGE_REQUIRED_ENV_KEYS.length}`}
            </strong>
          </div>
          <div className="probe-metric-item">
            <span className="probe-metric-label">工具过滤</span>
            <strong className="probe-metric-value">{bridgeAllowedTools.length} allow / {bridgeDisallowedTools.length} deny</strong>
          </div>
          <div className="probe-metric-item">
            <span className="probe-metric-label">设置来源</span>
            <strong className="probe-metric-value">{bridgeSettingSources.length ? bridgeSettingSources.join(' / ') : '全部关闭'}</strong>
          </div>
          <div className="probe-metric-item">
            <span className="probe-metric-label">Elasticsearch MCP</span>
            <strong className="probe-metric-value">{bridgeElasticsearchLabel}</strong>
          </div>
        </div>
        <div className="toolbar-group">
          <button className="button" type="button" disabled={testingBridge} onClick={() => void handleBridgeHealthTest()}>
            {testingBridge ? '测试中...' : '测试 Bridge 健康状态'}
          </button>
          <button className="button" type="button" disabled={testingBridge || initializingBridgeEsMcp} onClick={handleBridgeEsMcpInitialization}>
            {initializingBridgeEsMcp ? '创建中...' : 'ES_MCP 初始化'}
          </button>
          <button className="button" type="button" disabled={restartingBridge || testingBridge} onClick={() => void handleBridgeRestart()}>
            {restartingBridge ? '重启中...' : '重启 Bridge'}
          </button>
        </div>
        {bridgeHealthMessage ? <div className="status-inline status-inline-success">{bridgeHealthMessage}</div> : null}
      </SectionCard>

      <SectionCard
        title="告警字段映射"
        description="字段映射配置保存在独立 conf 文件中，并通过子窗口统一编辑。"
        actions={<button className="button button-primary" type="button" onClick={() => setFieldMappingsModalOpen(true)}>打开映射窗口</button>}
      >
        <div className="settings-mapping-summary">
          <div className="probe-metric-item">
            <span className="probe-metric-label">配置文件</span>
            <strong className="probe-metric-value">{fieldMappingsPath || 'conf/alert-field-mappings.json'}</strong>
          </div>
          <div className="probe-metric-item">
            <span className="probe-metric-label">映射数量</span>
            <strong className="probe-metric-value">{fieldMappingSchema.length}</strong>
          </div>
        </div>
      </SectionCard>

      {bridgeModalOpen ? (
        <div className="modal-backdrop" onClick={() => !savingBridge && setBridgeModalOpen(false)} role="presentation">
          <div className="modal-window settings-mapping-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <div>
                <div className="modal-title">Claude Code Bridge 配置</div>
                <div className="muted">悬浮聊天窗相关的 runner 默认值统一在这里配置，平台在创建任务和续聊时会自动注入。</div>
              </div>
              <div className="toolbar-group">
                <button className="button" type="button" disabled={savingBridge} onClick={() => setBridgeModalOpen(false)}>关闭</button>
              </div>
            </div>

            <div className="settings-note-grid">
              <div className="settings-note-card">
                <div className="settings-note-title">固定项</div>
                <div className="muted"><code>cwd</code> 固定为 <code>{BRIDGE_WORKSPACE_ROOT}</code>，不会按任务覆盖。</div>
              </div>
              <div className="settings-note-card">
                <div className="settings-note-title">项目默认项</div>
                <div className="muted"><code>workspace/.claude/.mcp.json</code> 提供 ES 默认 <code>SELK_ES_ENDPOINT</code>；启用“加载本地设置”时会读取 <code>workspace/.claude/settings.local.json</code>。</div>
              </div>
              <div className="settings-note-card">
                <div className="settings-note-title">注入与回显</div>
                <div className="muted">平台会把这里保存的默认 runtime config 注入到创建任务和续聊请求中；bridge 任务快照只会回显 <code>envKeys</code>、<code>hasApiKey</code> 这类脱敏标记。</div>
              </div>
            </div>

            <form className="settings-form" onSubmit={handleBridgeSubmit}>
              <div className="section-divider">
                <div>
                  <div className="section-title">Runtime Config 默认值</div>
                  <div className="section-subtitle">这些字段对应 bridge 的 <code>TaskRuntimeConfigInput</code>，创建任务和续聊时都会统一注入。</div>
                </div>
              </div>

              <div className="field-grid four">
                <label className="settings-field">
                  <span className="field-section-title">模型</span>
                  <input className="input" value={bridgeSettings.model} onChange={(event) => updateBridgeSettings('model', event.target.value)} placeholder="claude-opus-4-1" />
                </label>
                <label className="settings-field">
                  <span className="field-section-title">权限模式</span>
                  <select className="input" value={bridgeSettings.permissionMode} onChange={(event) => updateBridgeSettings('permissionMode', event.target.value as ClaudeCodeBridgeSettings['permissionMode'])}>
                    {CLAUDE_CODE_BRIDGE_PERMISSION_MODES.map((mode) => (
                      <option key={mode} value={mode}>{mode}</option>
                    ))}
                  </select>
                </label>
                <label className="settings-field">
                  <span className="field-section-title">思考强度</span>
                  <select className="input" value={bridgeSettings.effort} onChange={(event) => updateBridgeSettings('effort', event.target.value as ClaudeCodeBridgeSettings['effort'])}>
                    {CLAUDE_CODE_BRIDGE_EFFORTS.map((effort) => (
                      <option key={effort} value={effort}>{effort}</option>
                    ))}
                  </select>
                </label>
                <label className="settings-field">
                  <span className="field-section-title">最大轮次</span>
                  <input className="input" type="number" min={1} max={100} value={bridgeSettings.maxTurns} onChange={(event) => updateBridgeSettings('maxTurns', Math.max(1, Math.min(100, Number(event.target.value) || 1)))} />
                </label>
              </div>

              <div className="field-grid two">
                <label className="settings-field">
                  <span className="field-section-title">ANTHROPIC_BASE_URL</span>
                  <input
                    className="input"
                    required
                    value={bridgeSettings.anthropicBaseUrl}
                    onChange={(event) => updateBridgeSettings('anthropicBaseUrl', event.target.value)}
                    placeholder="https://your-anthropic-compatible-endpoint"
                  />
                </label>
                <label className="settings-field">
                  <span className="field-section-title">ANTHROPIC_AUTH_TOKEN</span>
                  <input
                    className="input"
                    type="password"
                    required
                    value={bridgeSettings.anthropicAuthToken}
                    onChange={(event) => updateBridgeSettings('anthropicAuthToken', event.target.value)}
                    placeholder="必填认证令牌"
                  />
                </label>
              </div>

              <div className="field-grid two">
                <label className="settings-field">
                  <span className="field-section-title">CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC</span>
                  <input
                    className="input"
                    required
                    value={bridgeSettings.claudeCodeDisableNonessentialTraffic}
                    onChange={(event) => updateBridgeSettings('claudeCodeDisableNonessentialTraffic', event.target.value)}
                    placeholder="1"
                  />
                  <span className="muted">默认建议填 <code>1</code>。这三个独立字段属于必填环境变量，优先级高于下面的额外环境变量文本框。</span>
                </label>
              </div>

              <div className="field-grid two">
                <label className="settings-field">
                  <span className="field-section-title">附加可访问目录</span>
                  <textarea className="textarea" value={bridgeSettings.additionalDirectoriesText} onChange={(event) => updateBridgeSettings('additionalDirectoriesText', event.target.value)} placeholder={'每行一个路径\nC:\\tmp'} />
                  <span className="muted">这里只补充额外可读写目录；Claude 主工作目录仍固定为 <code>{BRIDGE_WORKSPACE_ROOT}</code>。</span>
                </label>
                <label className="settings-field">
                  <span className="field-section-title">附加系统提示词</span>
                  <textarea className="textarea" value={bridgeSettings.systemPromptAppend} onChange={(event) => updateBridgeSettings('systemPromptAppend', event.target.value)} placeholder="可选的额外 Claude Code 指令" />
                </label>
              </div>

              <div className="field-grid two">
                <label className="settings-field">
                  <span className="field-section-title">允许的工具</span>
                  <textarea className="textarea" value={bridgeSettings.allowedToolsText} onChange={(event) => updateBridgeSettings('allowedToolsText', event.target.value)} placeholder={'每行一个工具模式\nmcp__elasticsearch__*'} />
                </label>
                <label className="settings-field">
                  <span className="field-section-title">禁止的工具</span>
                  <textarea className="textarea" value={bridgeSettings.disallowedToolsText} onChange={(event) => updateBridgeSettings('disallowedToolsText', event.target.value)} placeholder="可选的禁止列表" />
                </label>
              </div>

              <label className="settings-field">
                <span className="field-section-title">额外环境变量</span>
                <textarea className="textarea" value={bridgeSettings.envVarsText} onChange={(event) => updateBridgeSettings('envVarsText', event.target.value)} placeholder={'每行一个 KEY=VALUE\nANTHROPIC_API_KEY=...'} />
                <span className="muted">值会注入 Claude runtime；bridge 任务快照只会回显变量名，不回显值。这里若再填写上面三个同名键，会被独立必填项覆盖。</span>
              </label>

              <div className="toolbar-group">
                <label className="check-card"><input type="checkbox" checked={bridgeSettings.debug} onChange={(event) => updateBridgeSettings('debug', event.target.checked)} /><span>调试模式</span></label>
                <label className="check-card"><input type="checkbox" checked={bridgeSettings.strictMcpConfig} onChange={(event) => updateBridgeSettings('strictMcpConfig', event.target.checked)} /><span>严格 MCP 配置</span></label>
                <label className="check-card"><input type="checkbox" checked={bridgeSettings.loadSettingsUser} onChange={(event) => updateBridgeSettings('loadSettingsUser', event.target.checked)} /><span>加载用户设置</span></label>
                <label className="check-card"><input type="checkbox" checked={bridgeSettings.loadSettingsProject} onChange={(event) => updateBridgeSettings('loadSettingsProject', event.target.checked)} /><span>加载项目设置</span></label>
                <label className="check-card"><input type="checkbox" checked={bridgeSettings.loadSettingsLocal} onChange={(event) => updateBridgeSettings('loadSettingsLocal', event.target.checked)} /><span>加载本地设置</span></label>
              </div>

              <div className="section-divider">
                <div>
                  <div className="section-title">Elasticsearch MCP</div>
                  <div className="section-subtitle">这些值会在每次任务创建或续聊时转发进 bridge runtime config。</div>
                </div>
                <label className="check-card"><input type="checkbox" checked={bridgeSettings.elasticsearchEnabled} onChange={(event) => updateBridgeSettings('elasticsearchEnabled', event.target.checked)} /><span>启用</span></label>
              </div>

              <div className="field-grid two">
                <label className="settings-field">
                  <span className="field-section-title">ES Endpoint</span>
                  <input className="input" value={bridgeSettings.elasticsearchEndpoint} onChange={(event) => updateBridgeSettings('elasticsearchEndpoint', event.target.value)} placeholder="http://elasticsearch:9200" />
                  <span className="muted">留空时按 <code>workspace/.claude/.mcp.json</code> 里的 <code>SELK_ES_ENDPOINT</code> 作为默认值。</span>
                </label>
                <label className="settings-field">
                  <span className="field-section-title">Headers JSON</span>
                  <textarea className="textarea" value={bridgeSettings.elasticsearchHeadersJson} onChange={(event) => updateBridgeSettings('elasticsearchHeadersJson', event.target.value)} placeholder='{"x-found-cluster":"example"}' />
                </label>
              </div>

              <div className="field-grid two">
                <label className="settings-field">
                  <span className="field-section-title">ES API Key</span>
                  <input className="input" type="password" value={bridgeSettings.elasticsearchApiKey} onChange={(event) => updateBridgeSettings('elasticsearchApiKey', event.target.value)} placeholder="请输入 API Key" />
                </label>
                <label className="settings-field">
                  <span className="field-section-title">ES Bearer Token</span>
                  <input className="input" type="password" value={bridgeSettings.elasticsearchBearerToken} onChange={(event) => updateBridgeSettings('elasticsearchBearerToken', event.target.value)} placeholder="请输入 Bearer Token" />
                </label>
              </div>

              <div className="field-grid two">
                <label className="settings-field">
                  <span className="field-section-title">ES Username</span>
                  <input className="input" value={bridgeSettings.elasticsearchUsername} onChange={(event) => updateBridgeSettings('elasticsearchUsername', event.target.value)} placeholder="例如 elastic" />
                </label>
                <label className="settings-field">
                  <span className="field-section-title">ES Password</span>
                  <input className="input" type="password" value={bridgeSettings.elasticsearchPassword} onChange={(event) => updateBridgeSettings('elasticsearchPassword', event.target.value)} placeholder="请输入密码" />
                </label>
              </div>

              <div className="muted">这些 ES 认证和自定义 headers 会作为 task-scoped runtime override 注入，不会写回 <code>workspace/.claude/.mcp.json</code>。</div>

              <div className="settings-mapping-modal-footer">
                <span className="muted">悬浮聊天窗会使用这些默认值创建和续聊 Claude Code 任务。</span>
                <div className="toolbar-group">
                  <button className="button" type="button" disabled={savingBridge} onClick={() => setBridgeModalOpen(false)}>取消</button>
                  <button className="button button-primary" type="submit" disabled={savingBridge}>{savingBridge ? '保存中...' : '保存 Claude Code Bridge 配置'}</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {fieldMappingsModalOpen ? (
        <div className="modal-backdrop" onClick={() => !savingFieldMappings && setFieldMappingsModalOpen(false)} role="presentation">
          <div className="modal-window settings-mapping-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <div>
                <div className="modal-title">告警字段映射</div>
                <div className="muted">以表格方式统一编辑全部告警字段映射，保存后刷新告警相关页面生效。</div>
              </div>
              <div className="toolbar-group">
                <button className="button" type="button" disabled={savingFieldMappings} onClick={restoreFieldMappingDefaults}>恢复默认</button>
                <button className="button" type="button" disabled={savingFieldMappings} onClick={() => setFieldMappingsModalOpen(false)}>关闭</button>
              </div>
            </div>

            <form className="settings-form" onSubmit={handleFieldMappingsSubmit}>
              <div className="table-wrap">
                <table className="table settings-mapping-table">
                  <thead>
                    <tr>
                      <th>映射字段</th>
                      <th>当前值</th>
                      <th>默认值</th>
                      <th>说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fieldMappingSchema.map((item) => (
                      <tr key={item.key}>
                        <td>
                          <div className="settings-mapping-cell-title">{item.label}</div>
                        </td>
                        <td>
                          <input
                            className="input settings-mapping-input"
                            value={fieldMappings[item.key]}
                            onChange={(event) => setFieldMappings((current) => ({ ...current, [item.key]: event.target.value }))}
                            placeholder={item.placeholder}
                          />
                        </td>
                        <td>
                          <code className="settings-mapping-code">{item.defaultValue}</code>
                        </td>
                        <td>
                          <span className="muted">{item.description}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="settings-mapping-modal-footer">
                <span className="muted">配置文件：{fieldMappingsPath || 'conf/alert-field-mappings.json'}</span>
                <div className="toolbar-group">
                  <button className="button" type="button" disabled={savingFieldMappings} onClick={() => setFieldMappingsModalOpen(false)}>取消</button>
                  <button className="button button-primary" type="submit" disabled={savingFieldMappings}>{savingFieldMappings ? '保存中...' : '保存字段映射'}</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {error ? <div className="status-inline status-inline-error">{error}</div> : null}
      {success ? <div className="status-inline status-inline-success">{success}</div> : null}
    </section>
  );
}
