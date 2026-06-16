import { db } from '@/lib/db';

export type ProbeDispatcherAuthMode = 'bearer' | 'hmac';

type ProbeDispatcherTargetRow = {
  probe_id: string;
  display_name: string;
  base_url: string;
  auth_mode: ProbeDispatcherAuthMode;
  hmac_key_id: string | null;
  hmac_shared_secret: string | null;
  bearer_token: string | null;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
  last_seen_at: Date | null;
};

export type ProbeDispatcherTargetRecord = {
  probeId: string;
  displayName: string;
  baseUrl: string;
  authMode: ProbeDispatcherAuthMode;
  hmacKeyId?: string;
  hmacSecretConfigured: boolean;
  bearerTokenConfigured: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastSeenAt?: string;
};

export type ProbeDispatcherTargetSecretRecord = ProbeDispatcherTargetRecord & {
  hmacSharedSecret?: string;
  bearerToken?: string;
};

export type UpsertProbeDispatcherTargetInput = {
  probeId?: string;
  displayName?: string;
  baseUrl?: string;
  authMode?: ProbeDispatcherAuthMode;
  hmacKeyId?: string;
  hmacSharedSecret?: string;
  bearerToken?: string;
  enabled?: boolean;
};

let ensured = false;

function normalizeProbeId(value: unknown) {
  const probeId = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(probeId)) {
    throw new Error('probeId must start with a letter or digit and contain only lowercase letters, digits, underscore, or dash');
  }
  return probeId;
}

function normalizeDisplayName(value: unknown) {
  const displayName = typeof value === 'string' ? value.trim() : '';
  if (!displayName) {
    throw new Error('displayName is required');
  }
  if (displayName.length > 120) {
    throw new Error('displayName must be 120 characters or fewer');
  }
  return displayName;
}

function normalizeBaseUrl(value: unknown) {
  const baseUrl = typeof value === 'string' ? value.trim() : '';
  if (!baseUrl) {
    throw new Error('baseUrl is required');
  }

  const parsed = new URL(baseUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('baseUrl must use http or https');
  }
  parsed.hash = '';
  parsed.search = '';
  return parsed.toString().replace(/\/+$/, '');
}

function normalizeAuthMode(value: unknown): ProbeDispatcherAuthMode {
  const mode = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (mode !== 'bearer' && mode !== 'hmac') {
    throw new Error('authMode must be bearer or hmac');
  }
  return mode;
}

function normalizeHmacKeyId(value: unknown) {
  const keyId = typeof value === 'string' ? value.trim() : '';
  if (!keyId) {
    throw new Error('hmacKeyId is required for hmac authMode');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(keyId)) {
    throw new Error('hmacKeyId contains unsupported characters');
  }
  return keyId;
}

function normalizeSharedSecret(value: unknown, fieldName: string) {
  const secret = typeof value === 'string' ? value.trim() : '';
  if (!secret) {
    throw new Error(`${fieldName} is required`);
  }
  if (secret.length < 24) {
    throw new Error(`${fieldName} must be at least 24 characters long`);
  }
  return secret;
}

function toTargetRecord(row: ProbeDispatcherTargetRow, includeSecrets: boolean): ProbeDispatcherTargetRecord | ProbeDispatcherTargetSecretRecord {
  const base: ProbeDispatcherTargetRecord = {
    probeId: row.probe_id,
    displayName: row.display_name,
    baseUrl: row.base_url,
    authMode: row.auth_mode,
    hmacKeyId: row.hmac_key_id ?? undefined,
    hmacSecretConfigured: Boolean(row.hmac_shared_secret),
    bearerTokenConfigured: Boolean(row.bearer_token),
    enabled: row.enabled,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    lastSeenAt: row.last_seen_at?.toISOString(),
  };

  if (!includeSecrets) {
    return base;
  }

  return {
    ...base,
    hmacSharedSecret: row.hmac_shared_secret ?? undefined,
    bearerToken: row.bearer_token ?? undefined,
  };
}

async function ensureProbeDispatcherTargetTable() {
  if (ensured) return;
  await db.query(`
    create table if not exists probe_dispatcher_target (
      probe_id text primary key,
      display_name text not null,
      base_url text not null,
      auth_mode text not null,
      hmac_key_id text,
      hmac_shared_secret text,
      bearer_token text,
      enabled boolean not null default true,
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp,
      last_seen_at timestamptz
    )
  `);
  await db.query('create index if not exists idx_probe_dispatcher_target_enabled on probe_dispatcher_target(enabled)');
  ensured = true;
}

async function getStoredTargetRow(probeId: string) {
  await ensureProbeDispatcherTargetTable();
  const result = await db.query<ProbeDispatcherTargetRow>(
    `select probe_id, display_name, base_url, auth_mode, hmac_key_id, hmac_shared_secret, bearer_token, enabled, created_at, updated_at, last_seen_at
       from probe_dispatcher_target
      where probe_id = $1`,
    [probeId],
  );
  return result.rowCount ? result.rows[0] : null;
}

export async function listProbeDispatcherTargets() {
  await ensureProbeDispatcherTargetTable();
  const result = await db.query<ProbeDispatcherTargetRow>(
    `select probe_id, display_name, base_url, auth_mode, hmac_key_id, hmac_shared_secret, bearer_token, enabled, created_at, updated_at, last_seen_at
       from probe_dispatcher_target
      order by probe_id asc`,
  );
  return result.rows.map((row) => toTargetRecord(row, false) as ProbeDispatcherTargetRecord);
}

export async function getProbeDispatcherTarget(probeId: string) {
  const row = await getStoredTargetRow(normalizeProbeId(probeId));
  return row ? toTargetRecord(row, false) as ProbeDispatcherTargetRecord : null;
}

export async function getProbeDispatcherTargetWithSecrets(probeId: string) {
  const row = await getStoredTargetRow(normalizeProbeId(probeId));
  return row ? toTargetRecord(row, true) as ProbeDispatcherTargetSecretRecord : null;
}

export async function upsertProbeDispatcherTarget(input: UpsertProbeDispatcherTargetInput) {
  const probeId = normalizeProbeId(input.probeId);
  const existing = await getStoredTargetRow(probeId);
  const authMode = normalizeAuthMode(input.authMode ?? existing?.auth_mode ?? '');
  const displayName = normalizeDisplayName(input.displayName ?? existing?.display_name ?? '');
  const baseUrl = normalizeBaseUrl(input.baseUrl ?? existing?.base_url ?? '');
  const enabled = typeof input.enabled === 'boolean' ? input.enabled : existing?.enabled ?? true;

  let hmacKeyId: string | null = existing?.hmac_key_id ?? null;
  let hmacSharedSecret: string | null = existing?.hmac_shared_secret ?? null;
  let bearerToken: string | null = existing?.bearer_token ?? null;

  if (authMode === 'hmac') {
    hmacKeyId = normalizeHmacKeyId(input.hmacKeyId ?? existing?.hmac_key_id ?? '');
    hmacSharedSecret = input.hmacSharedSecret !== undefined
      ? normalizeSharedSecret(input.hmacSharedSecret, 'hmacSharedSecret')
      : existing?.hmac_shared_secret ?? null;
    if (!hmacSharedSecret) {
      throw new Error('hmacSharedSecret is required for hmac authMode');
    }
    bearerToken = null;
  } else {
    bearerToken = input.bearerToken !== undefined
      ? normalizeSharedSecret(input.bearerToken, 'bearerToken')
      : existing?.bearer_token ?? null;
    if (!bearerToken) {
      throw new Error('bearerToken is required for bearer authMode');
    }
    hmacKeyId = null;
    hmacSharedSecret = null;
  }

  await ensureProbeDispatcherTargetTable();
  const result = await db.query<ProbeDispatcherTargetRow>(
    `insert into probe_dispatcher_target (
       probe_id, display_name, base_url, auth_mode, hmac_key_id, hmac_shared_secret, bearer_token, enabled
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (probe_id)
     do update set
       display_name = excluded.display_name,
       base_url = excluded.base_url,
       auth_mode = excluded.auth_mode,
       hmac_key_id = excluded.hmac_key_id,
       hmac_shared_secret = excluded.hmac_shared_secret,
       bearer_token = excluded.bearer_token,
       enabled = excluded.enabled,
       updated_at = current_timestamp
     returning probe_id, display_name, base_url, auth_mode, hmac_key_id, hmac_shared_secret, bearer_token, enabled, created_at, updated_at, last_seen_at`,
    [probeId, displayName, baseUrl, authMode, hmacKeyId, hmacSharedSecret, bearerToken, enabled],
  );

  return toTargetRecord(result.rows[0], false) as ProbeDispatcherTargetRecord;
}

export async function deleteProbeDispatcherTarget(probeId: string) {
  await ensureProbeDispatcherTargetTable();
  await db.query('delete from probe_dispatcher_target where probe_id = $1', [normalizeProbeId(probeId)]);
}

export async function getPrimaryProbeDispatcherTarget(): Promise<ProbeDispatcherTargetRecord | null> {
  try {
    const targets = await listProbeDispatcherTargets();
    if (!targets.length) return null;
    return targets.find((target) => target.enabled) ?? targets[0];
  } catch {
    return null;
  }
}

export async function getPrimaryProbeDispatcherTargetWithSecrets(): Promise<ProbeDispatcherTargetSecretRecord | null> {
  const primary = await getPrimaryProbeDispatcherTarget();
  if (!primary) return null;
  return getProbeDispatcherTargetWithSecrets(primary.probeId);
}

export async function touchProbeDispatcherTargetLastSeen(probeId: string, seenAt = new Date()) {
  await ensureProbeDispatcherTargetTable();
  await db.query(
    `update probe_dispatcher_target
        set last_seen_at = $2,
            updated_at = current_timestamp
      where probe_id = $1`,
    [normalizeProbeId(probeId), seenAt.toISOString()],
  );
}

