import { db } from '@/lib/db';
import {
  ClaudeCodeBridgeSettings,
  defaultClaudeCodeBridgeSettings,
  isClaudeCodeBridgeEffort,
  isClaudeCodeBridgePermissionMode,
  validateClaudeCodeBridgeSettings,
} from '@/lib/claude-code-bridge-config';

const SETTINGS_KEY = 'claude_code_bridge_settings';

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

function normalizeString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeNumber(value: unknown, fallback: number) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(1, Math.min(100, Math.floor(num)));
}

export function normalizeClaudeCodeBridgeSettings(input: Partial<ClaudeCodeBridgeSettings> | null | undefined): ClaudeCodeBridgeSettings {
  const defaults = defaultClaudeCodeBridgeSettings();
  return {
    additionalDirectoriesText: normalizeString(input?.additionalDirectoriesText, defaults.additionalDirectoriesText),
    model: normalizeString(input?.model, defaults.model),
    permissionMode: isClaudeCodeBridgePermissionMode(input?.permissionMode) ? input.permissionMode : defaults.permissionMode,
    effort: isClaudeCodeBridgeEffort(input?.effort) ? input.effort : defaults.effort,
    maxTurns: normalizeNumber(input?.maxTurns, defaults.maxTurns),
    systemPromptAppend: normalizeString(input?.systemPromptAppend, defaults.systemPromptAppend),
    debug: normalizeBoolean(input?.debug, defaults.debug),
    strictMcpConfig: normalizeBoolean(input?.strictMcpConfig, defaults.strictMcpConfig),
    loadSettingsUser: normalizeBoolean(input?.loadSettingsUser, defaults.loadSettingsUser),
    loadSettingsProject: normalizeBoolean(input?.loadSettingsProject, defaults.loadSettingsProject),
    loadSettingsLocal: normalizeBoolean(input?.loadSettingsLocal, defaults.loadSettingsLocal),
    anthropicBaseUrl: normalizeString(input?.anthropicBaseUrl, defaults.anthropicBaseUrl),
    anthropicAuthToken: normalizeString(input?.anthropicAuthToken, defaults.anthropicAuthToken),
    claudeCodeDisableNonessentialTraffic: normalizeString(input?.claudeCodeDisableNonessentialTraffic, defaults.claudeCodeDisableNonessentialTraffic),
    envVarsText: normalizeString(input?.envVarsText, defaults.envVarsText),
    allowedToolsText: normalizeString(input?.allowedToolsText, defaults.allowedToolsText),
    disallowedToolsText: normalizeString(input?.disallowedToolsText, defaults.disallowedToolsText),
    elasticsearchEnabled: normalizeBoolean(input?.elasticsearchEnabled, defaults.elasticsearchEnabled),
    elasticsearchEndpoint: normalizeString(input?.elasticsearchEndpoint, defaults.elasticsearchEndpoint),
    elasticsearchApiKey: normalizeString(input?.elasticsearchApiKey, defaults.elasticsearchApiKey),
    elasticsearchBearerToken: normalizeString(input?.elasticsearchBearerToken, defaults.elasticsearchBearerToken),
    elasticsearchUsername: normalizeString(input?.elasticsearchUsername, defaults.elasticsearchUsername),
    elasticsearchPassword: normalizeString(input?.elasticsearchPassword, defaults.elasticsearchPassword),
    elasticsearchHeadersJson: normalizeString(input?.elasticsearchHeadersJson, defaults.elasticsearchHeadersJson),
  };
}

export async function getClaudeCodeBridgeSettings(): Promise<ClaudeCodeBridgeSettings> {
  try {
    await ensureSettingsTable();
    const result = await db.query<{ setting_value: Partial<ClaudeCodeBridgeSettings> }>(
      'select setting_value from platform_settings where setting_key = $1',
      [SETTINGS_KEY],
    );
    if (!result.rowCount) {
      return normalizeClaudeCodeBridgeSettings(undefined);
    }
    return normalizeClaudeCodeBridgeSettings(result.rows[0].setting_value);
  } catch {
    return normalizeClaudeCodeBridgeSettings(undefined);
  }
}

export async function putClaudeCodeBridgeSettings(settings: Partial<ClaudeCodeBridgeSettings>): Promise<ClaudeCodeBridgeSettings> {
  await ensureSettingsTable();
  const normalized = normalizeClaudeCodeBridgeSettings(settings);
  validateClaudeCodeBridgeSettings(normalized);
  await db.query(
    `insert into platform_settings (setting_key, setting_value)
     values ($1, $2::jsonb)
     on conflict (setting_key)
     do update set setting_value = excluded.setting_value, updated_at = current_timestamp`,
    [SETTINGS_KEY, JSON.stringify(normalized)],
  );
  return normalized;
}
