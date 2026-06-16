import { sendProbeDispatcherRequest } from '@/lib/probe-dispatcher-client';
import { getPrimaryProbeDispatcherTargetWithSecrets } from '@/lib/probe-dispatcher-store';

const DEFAULT_BASE_URL = process.env.SELK_RUNTIME_MONITOR_BASE_URL ?? 'http://127.0.0.1:19091';
const DEFAULT_METRICS_PATH = process.env.SELK_RUNTIME_MONITOR_METRICS_PATH ?? '/_selk_internal/v1/runtime-pulse/9f3a7c4e61/metrics';

type RuntimeStatus = 'healthy' | 'degraded' | 'down' | 'unknown';
type CommandStatus = 'succeeded' | 'failed';

export type RuntimeComponentSummary = {
  name: string;
  status: RuntimeStatus;
  message: string;
  unit?: string;
  activeState?: string;
  subState?: string;
  pid?: number;
  startedAt?: string;
  lastActivityAt?: string;
  logPath?: string;
  evidencePath?: string;
  healthUrl?: string;
  readyUrl?: string;
  processName?: string;
};

export type RuntimeCommandSummary = {
  executedAt?: string;
  requestedAt?: string;
  action?: string;
  target?: string;
  reason?: string;
  message?: string;
  status?: CommandStatus;
  units?: string[];
};

export type SystemUsageSummary = {
  cpu?: {
    usagePercent?: number | null;
    loadAverage?: { one?: number; five?: number; fifteen?: number };
  };
  memory?: {
    totalBytes?: number;
    availableBytes?: number;
    usedBytes?: number;
    usagePercent?: number | null;
  };
  disk?: {
    root?: {
      path?: string;
      totalBytes?: number;
      usedBytes?: number;
      freeBytes?: number;
      usagePercent?: number | null;
    };
    probeProd?: {
      path?: string;
      totalBytes?: number;
      usedBytes?: number;
      freeBytes?: number;
      usagePercent?: number | null;
    };
  };
};

export type RuntimeSummary = {
  generatedAt?: string;
  probeProdRoot?: string;
  statusPath?: string;
  metricsPath?: string;
  controlPath?: string;
  monitorBaseUrl?: string;
  probeDisplayName?: string;
  lastCommand?: RuntimeCommandSummary;
  system?: SystemUsageSummary;
  probe: RuntimeComponentSummary;
  engine: RuntimeComponentSummary;
  kafka: RuntimeComponentSummary;
  suricata: RuntimeComponentSummary;
};

function asString(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function joinUrlPath(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function asNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asNullableNumber(value: unknown) {
  return value === null ? null : asNumber(value);
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;
}

function isStatus(value: unknown): value is RuntimeStatus {
  return value === 'healthy' || value === 'degraded' || value === 'down' || value === 'unknown';
}

function isCommandStatus(value: unknown): value is CommandStatus {
  return value === 'succeeded' || value === 'failed';
}

function defaultComponent(name: string, message: string): RuntimeComponentSummary {
  return { name, status: 'unknown', message };
}

function parseComponent(name: string, value: unknown, fallbackMessage: string): RuntimeComponentSummary {
  if (!value || typeof value !== 'object') {
    return defaultComponent(name, fallbackMessage);
  }

  const record = value as Record<string, unknown>;
  return {
    name: asString(record.name) ?? name,
    status: isStatus(record.status) ? record.status : 'unknown',
    message: asString(record.message) ?? fallbackMessage,
    unit: asString(record.unit),
    activeState: asString(record.activeState),
    subState: asString(record.subState),
    pid: asNumber(record.pid),
    startedAt: asString(record.startedAt),
    lastActivityAt: asString(record.lastActivityAt),
    logPath: asString(record.logPath),
    evidencePath: asString(record.evidencePath),
    healthUrl: asString(record.healthUrl),
    readyUrl: asString(record.readyUrl),
    processName: asString(record.processName),
  };
}

function parseCommand(value: unknown): RuntimeCommandSummary | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  return {
    executedAt: asString(record.executedAt),
    requestedAt: asString(record.requestedAt),
    action: asString(record.action),
    target: asString(record.target),
    reason: asString(record.reason),
    message: asString(record.message),
    status: isCommandStatus(record.status) ? record.status : undefined,
    units: asStringArray(record.units),
  };
}

function parseSystemUsage(value: unknown): SystemUsageSummary | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const cpu = record.cpu && typeof record.cpu === 'object' ? record.cpu as Record<string, unknown> : undefined;
  const memory = record.memory && typeof record.memory === 'object' ? record.memory as Record<string, unknown> : undefined;
  const disk = record.disk && typeof record.disk === 'object' ? record.disk as Record<string, unknown> : undefined;
  const root = disk?.root && typeof disk.root === 'object' ? disk.root as Record<string, unknown> : undefined;
  const probeProd = disk?.probeProd && typeof disk.probeProd === 'object' ? disk.probeProd as Record<string, unknown> : undefined;

  return {
    cpu: cpu ? {
      usagePercent: asNullableNumber(cpu.usagePercent),
      loadAverage: cpu.loadAverage && typeof cpu.loadAverage === 'object'
        ? {
            one: asNumber((cpu.loadAverage as Record<string, unknown>).one),
            five: asNumber((cpu.loadAverage as Record<string, unknown>).five),
            fifteen: asNumber((cpu.loadAverage as Record<string, unknown>).fifteen),
          }
        : undefined,
    } : undefined,
    memory: memory ? {
      totalBytes: asNumber(memory.totalBytes),
      availableBytes: asNumber(memory.availableBytes),
      usedBytes: asNumber(memory.usedBytes),
      usagePercent: asNullableNumber(memory.usagePercent),
    } : undefined,
    disk: {
      root: root ? {
        path: asString(root.path),
        totalBytes: asNumber(root.totalBytes),
        usedBytes: asNumber(root.usedBytes),
        freeBytes: asNumber(root.freeBytes),
        usagePercent: asNullableNumber(root.usagePercent),
      } : undefined,
      probeProd: probeProd ? {
        path: asString(probeProd.path),
        totalBytes: asNumber(probeProd.totalBytes),
        usedBytes: asNumber(probeProd.usedBytes),
        freeBytes: asNumber(probeProd.freeBytes),
        usagePercent: asNullableNumber(probeProd.usagePercent),
      } : undefined,
    },
  };
}

export async function readRuntimeSummary(): Promise<RuntimeSummary> {
  let baseUrlForFallback = DEFAULT_BASE_URL;
  let displayNameForFallback: string | undefined;
  try {
    const primaryProbe = await getPrimaryProbeDispatcherTargetWithSecrets();
    if (!primaryProbe) {
      throw new Error('未配置探针：请先在设置中新增探针');
    }
    baseUrlForFallback = primaryProbe.baseUrl;
    displayNameForFallback = primaryProbe.displayName;

    const { statusCode, payload } = await sendProbeDispatcherRequest(
      primaryProbe,
      DEFAULT_METRICS_PATH,
      'GET',
      null,
    );

    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(asString(payload.message) ?? asString(payload.error) ?? `runtime monitor request failed with ${statusCode}`);
    }

    return {
      generatedAt: asString(payload.generatedAt),
      probeProdRoot: asString(payload.probeProdRoot),
      statusPath: asString(payload.statusPath),
      metricsPath: asString(payload.metricsPath),
      controlPath: asString(payload.controlPath),
      monitorBaseUrl: primaryProbe.baseUrl,
      probeDisplayName: primaryProbe.displayName,
      lastCommand: parseCommand(payload.lastCommand),
      system: parseSystemUsage(payload.system),
      probe: parseComponent('Probe', payload.probe, 'Probe 状态未知'),
      engine: parseComponent('Threat Engine', payload.engine, 'Threat Engine 状态未知'),
      kafka: parseComponent('Kafka Chain', payload.kafka, 'Kafka 状态未知'),
      suricata: parseComponent('Suricata', payload.suricata, 'Suricata 状态未知'),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '读取运行状态接口失败';
    return {
      generatedAt: undefined,
      probeProdRoot: undefined,
      statusPath: undefined,
      metricsPath: joinUrlPath(baseUrlForFallback, DEFAULT_METRICS_PATH),
      controlPath: undefined,
      monitorBaseUrl: baseUrlForFallback,
      probeDisplayName: displayNameForFallback,
      lastCommand: undefined,
      system: undefined,
      probe: defaultComponent('Probe', message),
      engine: defaultComponent('Threat Engine', message),
      kafka: defaultComponent('Kafka Chain', message),
      suricata: defaultComponent('Suricata', message),
    };
  }
}
