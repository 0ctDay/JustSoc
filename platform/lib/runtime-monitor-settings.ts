import { db } from '@/lib/db';

const SETTINGS_KEY = 'probe_monitor_http_base_url';

export type RuntimeMonitorSettings = {
  aiBaseUrl: string;
  aiApiKey: string;
  aiModel: string;
  aggregationWindowMinutes: number;
};

let ensured = false;

async function ensureSettingsTable() {
  if (ensured) return;
  await db.query(`
    create table if not exists platform_settings (
      setting_key text primary key,
      setting_value jsonb not null,
      updated_at timestamptz not null default current_timestamp
    )
  `);
  ensured = true;
}

function normalizeBaseUrl(value: unknown, fallback: string, fieldName: string) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    return fallback;
  }
  const parsed = new URL(trimmed);
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error(`${fieldName}蹇呴』鏄?http 鎴?https`);
  }
  return parsed.toString().replace(/\/+$/, '');
}

function normalizeApiKey(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeModel(value: unknown) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || 'gpt-4o-mini';
}

function normalizeAggregationWindowMinutes(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 20;
  return Math.max(1, Math.min(1440, Math.floor(num)));
}

export function normalizeRuntimeMonitorSettings(input: Partial<RuntimeMonitorSettings> | null | undefined): RuntimeMonitorSettings {
  return {
    aiBaseUrl: normalizeBaseUrl(input?.aiBaseUrl, '', 'AI HTTP 鍦板潃'),
    aiApiKey: normalizeApiKey(input?.aiApiKey),
    aiModel: normalizeModel(input?.aiModel),
    aggregationWindowMinutes: normalizeAggregationWindowMinutes(input?.aggregationWindowMinutes),
  };
}

export function sanitizeRuntimeMonitorSettingsForClient(settings: RuntimeMonitorSettings): RuntimeMonitorSettings {
  return settings;
}

export async function getRuntimeMonitorSettings(): Promise<RuntimeMonitorSettings> {
  try {
    await ensureSettingsTable();
    const result = await db.query<{ setting_value: Partial<RuntimeMonitorSettings> }>(
      'select setting_value from platform_settings where setting_key = $1',
      [SETTINGS_KEY],
    );
    if (!result.rowCount) {
      return normalizeRuntimeMonitorSettings(undefined);
    }
    return normalizeRuntimeMonitorSettings(result.rows[0].setting_value);
  } catch {
    return normalizeRuntimeMonitorSettings(undefined);
  }
}

export async function putRuntimeMonitorSettings(settings: Partial<RuntimeMonitorSettings>): Promise<RuntimeMonitorSettings> {
  await ensureSettingsTable();
  const normalized = normalizeRuntimeMonitorSettings(settings);
  await db.query(
    `insert into platform_settings (setting_key, setting_value)
     values ($1, $2::jsonb)
     on conflict (setting_key)
     do update set setting_value = excluded.setting_value, updated_at = current_timestamp`,
    [SETTINGS_KEY, JSON.stringify(normalized)],
  );
  return normalized;
}
