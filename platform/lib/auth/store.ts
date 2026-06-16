import { createHash, randomInt, randomUUID } from 'crypto';
import type { PoolClient } from 'pg';
import { db } from '@/lib/db';
import {
  AUTH_BRUTE_FORCE_WINDOW_MS,
  AUTH_CAPTCHA_AFTER_FAILURES,
  AUTH_CAPTCHA_TTL_MS,
  AUTH_LOCK_AFTER_FAILURES,
  AUTH_LOCK_TTL_MS,
  AUTH_PERMISSION_DEFINITIONS,
  AUTH_ROLE_DEFINITIONS,
  type AuthPermissionCode,
} from '@/lib/auth/config';
import {
  hashPassword,
  normalizeUsername,
  validateDisplayName,
  validatePassword,
  validateUsername,
  verifyPassword,
} from '@/lib/auth/password';

type TimestampLike = string | Date | null | undefined;

type AuthUserProfileRow = {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  is_active: boolean;
  must_change_password: boolean;
  last_login_at: Date | null;
  roles: string[];
  permissions: string[];
};

type AuthSessionRow = {
  session_id: string;
  user_id: string;
  username: string;
  display_name: string;
  is_active: boolean;
  must_change_password: boolean;
  expires_at: Date;
  roles: string[];
  permissions: string[];
};

type AuthRoleRow = {
  code: string;
  name: string;
  description: string;
  is_system: boolean;
  permissions: string[];
  created_at: Date;
  updated_at: Date;
};

type AuthUserListRow = {
  id: string;
  username: string;
  display_name: string;
  is_active: boolean;
  must_change_password: boolean;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
  roles: string[];
};

type AuthPermissionRow = {
  code: string;
  name: string;
  description: string;
};

type LoginGuardRow = {
  scope: 'ip' | 'user';
  subject: string;
  failure_count: number;
  locked_until: Date | null;
  captcha_until: Date | null;
  last_failed_at: Date | null;
};

type CaptchaRow = {
  id: string;
  answer_hash: string;
  challenge_meta: unknown;
  expires_at: Date;
  used_at: Date | null;
};

type SliderCaptchaMeta = {
  kind: 'slider';
  targetX: number;
  tolerance: number;
  pieceWidth: number;
  pieceHeight: number;
  pieceY: number;
  maxOffset: number;
  imageWidth: number;
  imageHeight: number;
  verifiedNonceHash?: string;
  verificationExpiresAt?: string;
};

export type AuthPermissionRecord = {
  code: string;
  name: string;
  description: string;
};

export type AuthRoleRecord = {
  code: string;
  name: string;
  description: string;
  isSystem: boolean;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
};

export type AuthUserRecord = {
  id: string;
  username: string;
  displayName: string;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
  roles: string[];
};

export type AuthUserProfile = {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt?: string;
  roles: string[];
  permissions: string[];
};

export type AuthSessionContext = {
  sessionId: string;
  userId: string;
  username: string;
  displayName: string;
  isActive: boolean;
  mustChangePassword: boolean;
  expiresAt: string;
  roles: string[];
  permissions: string[];
};

export type AuthBootstrapStatus = {
  requiresSetup: boolean;
  userCount: number;
};

export type LoginThrottleState = {
  failureCount: number;
  requiresCaptcha: boolean;
  lockedUntil?: string;
};

export type SliderCaptchaChallenge = {
  kind: 'slider';
  captchaId: string;
  backgroundImage: string;
  puzzleImage: string;
  imageWidth: number;
  imageHeight: number;
  pieceWidth: number;
  pieceHeight: number;
  pieceY: number;
  maxOffset: number;
  expiresAt: string;
};

export type SliderCaptchaVerification = {
  verified: true;
  verificationNonce: string;
  verificationExpiresAt: string;
};

export type CreateAuthUserInput = {
  username: string;
  displayName: string;
  password: string;
  roles: string[];
  isActive?: boolean;
  mustChangePassword?: boolean;
};

export type UpdateAuthUserInput = {
  displayName?: string;
  password?: string;
  roles?: string[];
  isActive?: boolean;
  mustChangePassword?: boolean;
};

export type UpsertAuthRoleInput = {
  code: string;
  name: string;
  description: string;
  permissions: string[];
};

export type BootstrapAdminInput = {
  username: string;
  displayName: string;
  password: string;
};

let ensurePromise: Promise<void> | null = null;

function toIsoString(value: TimestampLike) {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function normalizeRoleCode(input: unknown) {
  return typeof input === 'string' ? input.trim().toLowerCase() : '';
}

function validateRoleCode(input: unknown) {
  const value = normalizeRoleCode(input);
  if (!/^[a-z][a-z0-9_-]{2,31}$/.test(value)) {
    throw new Error('角色编码需以字母开头，仅支持字母、数字、下划线和中划线，长度 3-32');
  }
  return value;
}

function validateRoleName(input: unknown) {
  const value = typeof input === 'string' ? input.trim() : '';
  if (!value) throw new Error('角色名称不能为空');
  if (value.length > 64) throw new Error('角色名称长度不能超过 64');
  return value;
}

function validateRoleDescription(input: unknown) {
  const value = typeof input === 'string' ? input.trim() : '';
  if (!value) throw new Error('角色描述不能为空');
  if (value.length > 200) throw new Error('角色描述长度不能超过 200');
  return value;
}

function normalizePermissionCodes(input: unknown) {
  if (!Array.isArray(input)) throw new Error('权限列表格式不正确');
  const unique = [...new Set(input.map((value) => String(value).trim()).filter(Boolean))];
  if (!unique.length) throw new Error('至少需要保留一个权限');
  return unique;
}

function makeCaptchaHash(answer: string) {
  return createHash('sha256').update(answer).digest('hex');
}

function toDataUri(svg: string) {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function createPuzzlePath(x: number, y: number, size: number) {
  const startX = x + 8;
  const startY = y + 8;
  const topKnobStart = x + 18;
  const topKnobPeakX = x + Math.floor(size / 2);
  const topKnobEnd = x + 34;
  const rightKnobStart = y + 18;
  const rightKnobPeakY = y + Math.floor(size / 2);
  const rightKnobEnd = y + 34;
  const rightEdge = x + size - 8;
  const bottomEdge = y + size - 8;

  return [
    `M ${startX} ${startY}`,
    `H ${topKnobStart}`,
    `Q ${topKnobPeakX} ${y} ${topKnobEnd} ${startY}`,
    `H ${rightEdge}`,
    `V ${rightKnobStart}`,
    `Q ${x + size} ${rightKnobPeakY} ${rightEdge} ${rightKnobEnd}`,
    `V ${bottomEdge}`,
    `H ${startX}`,
    'Z',
  ].join(' ');
}

function renderSliderScene(width: number, height: number) {
  const hue = randomInt(205, 231);
  const accentHue = randomInt(8, 28);
  const circles = Array.from({ length: 9 }, () => {
    const cx = randomInt(12, width - 12);
    const cy = randomInt(12, height - 12);
    const radius = randomInt(10, 34);
    const opacity = (randomInt(14, 28) / 100).toFixed(2);
    const fill = `hsla(${randomInt(hue - 12, hue + 12)}, 78%, ${randomInt(62, 84)}%, ${opacity})`;
    return `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${fill}" />`;
  }).join('');

  const panels = Array.from({ length: 6 }, () => {
    const panelWidth = randomInt(54, 110);
    const panelHeight = randomInt(18, 36);
    const x = randomInt(-10, width - panelWidth + 10);
    const y = randomInt(10, height - panelHeight - 10);
    const rotate = randomInt(-14, 15);
    const opacity = (randomInt(22, 38) / 100).toFixed(2);
    const fill = `hsla(${randomInt(accentHue, accentHue + 14)}, 92%, ${randomInt(68, 82)}%, ${opacity})`;
    return `<rect x="${x}" y="${y}" width="${panelWidth}" height="${panelHeight}" rx="12" fill="${fill}" transform="rotate(${rotate} ${x + panelWidth / 2} ${y + panelHeight / 2})" />`;
  }).join('');

  const beams = Array.from({ length: 5 }, () => {
    const x1 = randomInt(0, width);
    const y1 = randomInt(0, height);
    const x2 = randomInt(0, width);
    const y2 = randomInt(0, height);
    const stroke = `hsla(${randomInt(hue - 10, hue + 10)}, 88%, 52%, ${(randomInt(18, 32) / 100).toFixed(2)})`;
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${randomInt(2, 4)}" stroke-linecap="round" />`;
  }).join('');

  return [
    `<rect width="${width}" height="${height}" rx="18" fill="url(#slider-bg-gradient)" />`,
    '<rect width="100%" height="100%" rx="18" fill="url(#slider-grid)" opacity="0.38" />',
    panels,
    circles,
    beams,
    `<path d="M0 ${height - 28} C ${Math.floor(width * 0.2)} ${height - 56}, ${Math.floor(width * 0.48)} ${height - 4}, ${Math.floor(width * 0.72)} ${height - 24} S ${width} ${height - 12}, ${width} ${height - 36} V ${height} H 0 Z" fill="rgba(15, 23, 42, 0.10)" />`,
  ].join('');
}

function buildSliderCaptchaImages(meta: SliderCaptchaMeta) {
  const sceneContent = renderSliderScene(meta.imageWidth, meta.imageHeight);
  const holePath = createPuzzlePath(meta.targetX, meta.pieceY, meta.pieceWidth);
  const piecePath = createPuzzlePath(0, 0, meta.pieceWidth);

  const defs = [
    '<defs>',
    '<linearGradient id="slider-bg-gradient" x1="0%" y1="0%" x2="100%" y2="100%">',
    '<stop offset="0%" stop-color="#eff6ff" />',
    '<stop offset="55%" stop-color="#dbeafe" />',
    '<stop offset="100%" stop-color="#fee2e2" />',
    '</linearGradient>',
    '<pattern id="slider-grid" width="24" height="24" patternUnits="userSpaceOnUse">',
    '<path d="M 24 0 L 0 0 0 24" fill="none" stroke="rgba(148, 163, 184, 0.26)" stroke-width="1" />',
    '</pattern>',
    '<filter id="slider-shadow" x="-20%" y="-20%" width="140%" height="140%">',
    '<feDropShadow dx="0" dy="6" stdDeviation="6" flood-color="rgba(15, 23, 42, 0.22)" />',
    '</filter>',
    '<filter id="slider-hole-glow" x="-20%" y="-20%" width="140%" height="140%">',
    '<feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="rgba(255, 255, 255, 0.55)" />',
    '</filter>',
    `<clipPath id="slider-piece-clip"><path d="${piecePath}" /></clipPath>`,
    '</defs>',
  ].join('');

  const backgroundSvg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${meta.imageWidth}" height="${meta.imageHeight}" viewBox="0 0 ${meta.imageWidth} ${meta.imageHeight}">`,
    defs,
    sceneContent,
    `<path d="${holePath}" fill="rgba(255,255,255,0.72)" stroke="rgba(15,23,42,0.26)" stroke-width="2" stroke-dasharray="5 4" filter="url(#slider-hole-glow)" />`,
    `<path d="${holePath}" fill="rgba(15,23,42,0.08)" />`,
    '</svg>',
  ].join('');

  const pieceSvg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${meta.pieceWidth}" height="${meta.pieceHeight}" viewBox="0 0 ${meta.pieceWidth} ${meta.pieceHeight}">`,
    defs,
    `<g clip-path="url(#slider-piece-clip)" filter="url(#slider-shadow)" transform="translate(${-meta.targetX} ${-meta.pieceY})">`,
    sceneContent,
    '</g>',
    `<path d="${piecePath}" fill="none" stroke="rgba(15,23,42,0.34)" stroke-width="2" />`,
    `<path d="${piecePath}" fill="rgba(255,255,255,0.12)" />`,
    '</svg>',
  ].join('');

  return {
    backgroundImage: toDataUri(backgroundSvg),
    puzzleImage: toDataUri(pieceSvg),
  };
}

function normalizeSliderCaptchaMeta(value: unknown): SliderCaptchaMeta | null {
  if (!value || typeof value !== 'object') return null;
  const meta = value as Partial<SliderCaptchaMeta>;
  if (meta.kind !== 'slider') return null;
  const targetX = Number(meta.targetX);
  const tolerance = Number(meta.tolerance);
  const pieceWidth = Number(meta.pieceWidth);
  const pieceHeight = Number(meta.pieceHeight);
  const pieceY = Number(meta.pieceY);
  const maxOffset = Number(meta.maxOffset);
  const imageWidth = Number(meta.imageWidth);
  const imageHeight = Number(meta.imageHeight);
  if (![targetX, tolerance, pieceWidth, pieceHeight, pieceY, maxOffset, imageWidth, imageHeight].every(Number.isFinite)) {
    return null;
  }
  return {
    kind: 'slider',
    targetX,
    tolerance,
    pieceWidth,
    pieceHeight,
    pieceY,
    maxOffset,
    imageWidth,
    imageHeight,
    verifiedNonceHash: typeof meta.verifiedNonceHash === 'string' ? meta.verifiedNonceHash : undefined,
    verificationExpiresAt: typeof meta.verificationExpiresAt === 'string' ? meta.verificationExpiresAt : undefined,
  };
}

function toUserProfile(row: AuthUserProfileRow): AuthUserProfile {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    isActive: row.is_active,
    mustChangePassword: row.must_change_password,
    lastLoginAt: toIsoString(row.last_login_at),
    roles: row.roles ?? [],
    permissions: row.permissions ?? [],
  };
}

function toSessionContext(row: AuthSessionRow): AuthSessionContext {
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    isActive: row.is_active,
    mustChangePassword: row.must_change_password,
    expiresAt: row.expires_at.toISOString(),
    roles: row.roles ?? [],
    permissions: row.permissions ?? [],
  };
}

function toRoleRecord(row: AuthRoleRow): AuthRoleRecord {
  return {
    code: row.code,
    name: row.name,
    description: row.description,
    isSystem: row.is_system,
    permissions: row.permissions ?? [],
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toUserRecord(row: AuthUserListRow): AuthUserRecord {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    isActive: row.is_active,
    mustChangePassword: row.must_change_password,
    lastLoginAt: toIsoString(row.last_login_at),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    roles: row.roles ?? [],
  };
}

async function revokeSessionsForUser(client: PoolClient, userId: string) {
  await client.query(
    `update auth_session
     set revoked_at = current_timestamp
     where user_id = $1 and revoked_at is null`,
    [userId],
  );
}

async function revokeSessionsForRole(client: PoolClient, roleCode: string) {
  await client.query(
    `update auth_session as s
     set revoked_at = current_timestamp
     from auth_user_role as ur
     where s.user_id = ur.user_id
       and ur.role_code = $1
       and s.revoked_at is null`,
    [roleCode],
  );
}

async function assertRoleCodesExist(client: PoolClient, roleCodes: string[]) {
  if (!roleCodes.length) throw new Error('至少需要分配一个角色');
  const normalized = [...new Set(roleCodes.map((value) => normalizeRoleCode(value)).filter(Boolean))];
  const result = await client.query<{ code: string }>(
    'select code from auth_role where code = any($1::text[])',
    [normalized],
  );

  const existing = new Set(result.rows.map((row) => row.code));
  const missing = normalized.filter((code) => !existing.has(code));
  if (missing.length) {
    throw new Error(`角色不存在: ${missing.join(', ')}`);
  }
  return normalized;
}

async function assertPermissionCodesExist(client: PoolClient, permissionCodes: string[]) {
  const normalized = normalizePermissionCodes(permissionCodes);
  const result = await client.query<{ code: string }>(
    'select code from auth_permission where code = any($1::text[])',
    [normalized],
  );

  const existing = new Set(result.rows.map((row) => row.code));
  const missing = normalized.filter((code) => !existing.has(code));
  if (missing.length) {
    throw new Error(`权限不存在: ${missing.join(', ')}`);
  }
  return normalized;
}

async function replaceUserRoles(client: PoolClient, userId: string, roleCodes: string[]) {
  await client.query('delete from auth_user_role where user_id = $1', [userId]);
  for (const roleCode of roleCodes) {
    await client.query(
      `insert into auth_user_role (user_id, role_code)
       values ($1, $2)
       on conflict (user_id, role_code) do nothing`,
      [userId, roleCode],
    );
  }
}

async function replaceRolePermissions(client: PoolClient, roleCode: string, permissionCodes: string[]) {
  await client.query('delete from auth_role_permission where role_code = $1', [roleCode]);
  for (const permissionCode of permissionCodes) {
    await client.query(
      `insert into auth_role_permission (role_code, permission_code)
       values ($1, $2)
       on conflict (role_code, permission_code) do nothing`,
      [roleCode, permissionCode],
    );
  }
}

async function countActiveAdminUsers(client: PoolClient) {
  const result = await client.query<{ total: string }>(
    `select count(distinct u.id)::text as total
     from auth_user as u
     join auth_user_role as ur on ur.user_id = u.id
     where ur.role_code = 'admin' and u.is_active = true`,
  );

  return Number(result.rows[0]?.total ?? '0');
}

async function findUserProfileById(client: PoolClient, userId: string) {
  const result = await client.query<AuthUserProfileRow>(
    `select
       u.id,
       u.username,
       u.display_name,
       u.password_hash,
       u.is_active,
       u.must_change_password,
       u.last_login_at,
       coalesce(array_remove(array_agg(distinct ur.role_code), null), '{}'::text[]) as roles,
       coalesce(array_remove(array_agg(distinct rp.permission_code), null), '{}'::text[]) as permissions
     from auth_user as u
     left join auth_user_role as ur on ur.user_id = u.id
     left join auth_role_permission as rp on rp.role_code = ur.role_code
     where u.id = $1
     group by u.id`,
    [userId],
  );

  return result.rowCount ? toUserProfile(result.rows[0]) : null;
}

async function seedPermissionsAndRoles(client: PoolClient) {
  for (const permission of AUTH_PERMISSION_DEFINITIONS) {
    await client.query(
      `insert into auth_permission (code, name, description)
       values ($1, $2, $3)
       on conflict (code)
       do update set name = excluded.name, description = excluded.description`,
      [permission.code, permission.name, permission.description],
    );
  }

  for (const role of AUTH_ROLE_DEFINITIONS) {
    await client.query(
      `insert into auth_role (code, name, description, is_system)
       values ($1, $2, $3, $4)
       on conflict (code)
       do update set name = excluded.name, description = excluded.description, is_system = excluded.is_system, updated_at = current_timestamp`,
      [role.code, role.name, role.description, role.isSystem],
    );
    await replaceRolePermissions(client, role.code, [...role.permissions]);
  }
}

export async function ensureAuthSchema() {
  if (ensurePromise) {
    await ensurePromise;
    return;
  }

  ensurePromise = (async () => {
    const client = await db.connect();
    try {
      await client.query(`
        create table if not exists auth_permission (
          code text primary key,
          name text not null,
          description text not null
        )
      `);
      await client.query(`
        create table if not exists auth_role (
          code text primary key,
          name text not null,
          description text not null,
          is_system boolean not null default false,
          created_at timestamptz not null default current_timestamp,
          updated_at timestamptz not null default current_timestamp
        )
      `);
      await client.query(`
        create table if not exists auth_role_permission (
          role_code text not null references auth_role(code) on delete cascade,
          permission_code text not null references auth_permission(code) on delete cascade,
          created_at timestamptz not null default current_timestamp,
          primary key (role_code, permission_code)
        )
      `);
      await client.query(`
        create table if not exists auth_user (
          id text primary key,
          username text not null unique,
          display_name text not null,
          password_hash text not null,
          is_active boolean not null default true,
          must_change_password boolean not null default false,
          last_login_at timestamptz null,
          created_at timestamptz not null default current_timestamp,
          updated_at timestamptz not null default current_timestamp
        )
      `);
      await client.query(`
        create table if not exists auth_user_role (
          user_id text not null references auth_user(id) on delete cascade,
          role_code text not null references auth_role(code) on delete cascade,
          created_at timestamptz not null default current_timestamp,
          primary key (user_id, role_code)
        )
      `);
      await client.query(`
        create table if not exists auth_session (
          id text primary key,
          user_id text not null references auth_user(id) on delete cascade,
          ip_address text null,
          user_agent text null,
          expires_at timestamptz not null,
          revoked_at timestamptz null,
          created_at timestamptz not null default current_timestamp,
          last_seen_at timestamptz not null default current_timestamp
        )
      `);
      await client.query(`
        create table if not exists auth_login_guard (
          scope text not null,
          subject text not null,
          failure_count integer not null default 0,
          locked_until timestamptz null,
          captcha_until timestamptz null,
          last_failed_at timestamptz null,
          updated_at timestamptz not null default current_timestamp,
          primary key (scope, subject)
        )
      `);
      await client.query(`
        create table if not exists auth_captcha (
          id text primary key,
          answer_hash text not null,
          challenge_meta jsonb not null default '{}'::jsonb,
          expires_at timestamptz not null,
          used_at timestamptz null,
          created_at timestamptz not null default current_timestamp
        )
      `);
      await client.query(`
        alter table auth_captcha
        add column if not exists challenge_meta jsonb not null default '{}'::jsonb
      `);
      await client.query('create index if not exists idx_auth_session_user_id on auth_session(user_id)');
      await client.query('create index if not exists idx_auth_session_expires_at on auth_session(expires_at)');
      await client.query('create index if not exists idx_auth_login_guard_updated_at on auth_login_guard(updated_at)');
      await client.query('create index if not exists idx_auth_captcha_expires_at on auth_captcha(expires_at)');
      await seedPermissionsAndRoles(client);
    } finally {
      client.release();
    }
  })();

  try {
    await ensurePromise;
  } catch (error) {
    ensurePromise = null;
    throw error;
  }
}

export async function getAuthBootstrapStatus(): Promise<AuthBootstrapStatus> {
  await ensureAuthSchema();
  const result = await db.query<{ total: string }>('select count(*)::text as total from auth_user');
  const userCount = Number(result.rows[0]?.total ?? '0');
  return {
    requiresSetup: userCount === 0,
    userCount,
  };
}

export async function listAuthPermissions(): Promise<AuthPermissionRecord[]> {
  await ensureAuthSchema();
  const result = await db.query<AuthPermissionRow>(
    'select code, name, description from auth_permission order by code asc',
  );
  return result.rows.map((row) => ({
    code: row.code,
    name: row.name,
    description: row.description,
  }));
}

export async function listAuthRoles(): Promise<AuthRoleRecord[]> {
  await ensureAuthSchema();
  const result = await db.query<AuthRoleRow>(
    `select
       r.code,
       r.name,
       r.description,
       r.is_system,
       r.created_at,
       r.updated_at,
       coalesce(array_remove(array_agg(distinct rp.permission_code), null), '{}'::text[]) as permissions
     from auth_role as r
     left join auth_role_permission as rp on rp.role_code = r.code
     group by r.code
     order by r.is_system desc, r.code asc`,
  );
  return result.rows.map(toRoleRecord);
}

export async function listAuthUsers(): Promise<AuthUserRecord[]> {
  await ensureAuthSchema();
  const result = await db.query<AuthUserListRow>(
    `select
       u.id,
       u.username,
       u.display_name,
       u.is_active,
       u.must_change_password,
       u.last_login_at,
       u.created_at,
       u.updated_at,
       coalesce(array_remove(array_agg(distinct ur.role_code), null), '{}'::text[]) as roles
     from auth_user as u
     left join auth_user_role as ur on ur.user_id = u.id
     group by u.id
     order by u.created_at asc`,
  );
  return result.rows.map(toUserRecord);
}

export async function getUserProfileByUsername(username: string) {
  await ensureAuthSchema();
  const normalized = normalizeUsername(username);
  if (!normalized) return null;

  const result = await db.query<AuthUserProfileRow>(
    `select
       u.id,
       u.username,
       u.display_name,
       u.password_hash,
       u.is_active,
       u.must_change_password,
       u.last_login_at,
       coalesce(array_remove(array_agg(distinct ur.role_code), null), '{}'::text[]) as roles,
       coalesce(array_remove(array_agg(distinct rp.permission_code), null), '{}'::text[]) as permissions
     from auth_user as u
     left join auth_user_role as ur on ur.user_id = u.id
     left join auth_role_permission as rp on rp.role_code = ur.role_code
     where u.username = $1
     group by u.id`,
    [normalized],
  );

  return result.rowCount ? toUserProfile(result.rows[0]) : null;
}

export async function getUserProfileById(userId: string) {
  await ensureAuthSchema();
  const client = await db.connect();
  try {
    return await findUserProfileById(client, userId);
  } finally {
    client.release();
  }
}

export async function bootstrapAdminUser(input: BootstrapAdminInput) {
  await ensureAuthSchema();
  const client = await db.connect();
  try {
    await client.query('begin');
    const status = await client.query<{ total: string }>('select count(*)::text as total from auth_user');
    if (Number(status.rows[0]?.total ?? '0') > 0) {
      throw new Error('平台已完成初始化，不能重复创建首个管理员');
    }

    const username = validateUsername(input.username);
    const displayName = validateDisplayName(input.displayName);
    const password = validatePassword(input.password);
    const passwordHash = await hashPassword(password);
    const userId = randomUUID();

    await client.query(
      `insert into auth_user (id, username, display_name, password_hash, is_active, must_change_password)
       values ($1, $2, $3, $4, true, false)`,
      [userId, username, displayName, passwordHash],
    );
    await replaceUserRoles(client, userId, ['admin']);
    await client.query('commit');

    const profile = await findUserProfileById(client, userId);
    if (!profile) throw new Error('初始化管理员创建失败');
    return profile;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function createAuthUser(input: CreateAuthUserInput) {
  await ensureAuthSchema();
  const client = await db.connect();
  try {
    await client.query('begin');
    const username = validateUsername(input.username);
    const displayName = validateDisplayName(input.displayName);
    const password = validatePassword(input.password);
    const roles = await assertRoleCodesExist(client, input.roles);
    const passwordHash = await hashPassword(password);
    const userId = randomUUID();

    await client.query(
      `insert into auth_user (id, username, display_name, password_hash, is_active, must_change_password)
       values ($1, $2, $3, $4, $5, $6)`,
      [userId, username, displayName, passwordHash, input.isActive ?? true, input.mustChangePassword ?? false],
    );
    await replaceUserRoles(client, userId, roles);
    await client.query('commit');

    const profile = await findUserProfileById(client, userId);
    if (!profile) throw new Error('用户创建失败');
    return profile;
  } catch (error) {
    await client.query('rollback');
    const message = error instanceof Error ? error.message : '用户创建失败';
    if (message.includes('auth_user_username_key')) {
      throw new Error('用户名已存在');
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function updateAuthUser(userId: string, input: UpdateAuthUserInput) {
  await ensureAuthSchema();
  const client = await db.connect();
  try {
    await client.query('begin');

    const existing = await findUserProfileById(client, userId);
    if (!existing) throw new Error('用户不存在');

    const nextDisplayName = input.displayName === undefined ? existing.displayName : validateDisplayName(input.displayName);
    const nextIsActive = input.isActive === undefined ? existing.isActive : Boolean(input.isActive);
    const nextMustChangePassword = input.mustChangePassword === undefined ? existing.mustChangePassword : Boolean(input.mustChangePassword);
    const nextRoles = input.roles === undefined ? existing.roles : await assertRoleCodesExist(client, input.roles);

    const wasAdmin = existing.roles.includes('admin') && existing.isActive;
    const remainsAdmin = nextRoles.includes('admin') && nextIsActive;
    if (wasAdmin && !remainsAdmin) {
      const activeAdmins = await countActiveAdminUsers(client);
      if (activeAdmins <= 1) {
        throw new Error('至少需要保留一个启用状态的管理员');
      }
    }

    let nextPasswordHash = existing.passwordHash;
    let shouldRevokeSessions = false;
    if (typeof input.password === 'string' && input.password.length > 0) {
      nextPasswordHash = await hashPassword(validatePassword(input.password));
      shouldRevokeSessions = true;
    }

    if (nextDisplayName !== existing.displayName || nextIsActive !== existing.isActive || nextMustChangePassword !== existing.mustChangePassword) {
      shouldRevokeSessions = shouldRevokeSessions || nextIsActive !== existing.isActive;
      await client.query(
        `update auth_user
         set display_name = $2,
             password_hash = $3,
             is_active = $4,
             must_change_password = $5,
             updated_at = current_timestamp
         where id = $1`,
        [userId, nextDisplayName, nextPasswordHash, nextIsActive, nextMustChangePassword],
      );
    } else if (nextPasswordHash !== existing.passwordHash) {
      await client.query(
        `update auth_user
         set password_hash = $2, updated_at = current_timestamp
         where id = $1`,
        [userId, nextPasswordHash],
      );
    }

    const existingRolesSorted = [...existing.roles].sort().join(',');
    const nextRolesSorted = [...nextRoles].sort().join(',');
    if (existingRolesSorted !== nextRolesSorted) {
      await replaceUserRoles(client, userId, nextRoles);
      shouldRevokeSessions = true;
    }

    if (shouldRevokeSessions) {
      await revokeSessionsForUser(client, userId);
    }

    await client.query('commit');
    const profile = await findUserProfileById(client, userId);
    if (!profile) throw new Error('用户更新失败');
    return profile;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function changeOwnPassword(userId: string, currentSessionId: string, currentPassword: string, nextPassword: string) {
  await ensureAuthSchema();
  const client = await db.connect();
  try {
    await client.query('begin');

    const existing = await findUserProfileById(client, userId);
    if (!existing) {
      throw new Error('当前用户不存在');
    }

    const validCurrent = await verifyPassword(currentPassword, existing.passwordHash);
    if (!validCurrent) {
      throw new Error('当前密码不正确');
    }

    const validNextPassword = validatePassword(nextPassword);
    const sameAsCurrent = await verifyPassword(validNextPassword, existing.passwordHash);
    if (sameAsCurrent) {
      throw new Error('新密码不能与当前密码相同');
    }

    const nextPasswordHash = await hashPassword(validNextPassword);
    await client.query(
      `update auth_user
       set password_hash = $2,
           must_change_password = false,
           updated_at = current_timestamp
       where id = $1`,
      [userId, nextPasswordHash],
    );

    await client.query(
      `update auth_session
       set revoked_at = current_timestamp
       where user_id = $1
         and revoked_at is null
         and id <> $2`,
      [userId, currentSessionId],
    );

    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function upsertAuthRole(input: UpsertAuthRoleInput, existingRoleCode?: string) {
  await ensureAuthSchema();
  const client = await db.connect();
  try {
    await client.query('begin');
    const roleCode = existingRoleCode ? validateRoleCode(existingRoleCode) : validateRoleCode(input.code);
    const nextCode = validateRoleCode(input.code);
    if (existingRoleCode && roleCode !== nextCode) {
      throw new Error('暂不支持修改角色编码');
    }

    const name = validateRoleName(input.name);
    const description = validateRoleDescription(input.description);
    const permissions = await assertPermissionCodesExist(client, input.permissions);

    const existing = await client.query<{ code: string; is_system: boolean }>(
      'select code, is_system from auth_role where code = $1',
      [roleCode],
    );

    if (existing.rowCount && existing.rows[0].is_system) {
      throw new Error('系统内置角色不允许修改');
    }

    await client.query(
      `insert into auth_role (code, name, description, is_system)
       values ($1, $2, $3, false)
       on conflict (code)
       do update set name = excluded.name, description = excluded.description, updated_at = current_timestamp`,
      [roleCode, name, description],
    );
    await replaceRolePermissions(client, roleCode, permissions);
    await revokeSessionsForRole(client, roleCode);
    await client.query('commit');

    const roles = await client.query<AuthRoleRow>(
      `select
         r.code,
         r.name,
         r.description,
         r.is_system,
         r.created_at,
         r.updated_at,
         coalesce(array_remove(array_agg(distinct rp.permission_code), null), '{}'::text[]) as permissions
       from auth_role as r
       left join auth_role_permission as rp on rp.role_code = r.code
       where r.code = $1
       group by r.code`,
      [roleCode],
    );

    if (!roles.rowCount) throw new Error('角色保存失败');
    return toRoleRecord(roles.rows[0]);
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function createAuthSession(userId: string, expiresAt: Date, metadata?: { ipAddress?: string; userAgent?: string }) {
  await ensureAuthSchema();
  const sessionId = randomUUID();
  await db.query(
    `insert into auth_session (id, user_id, ip_address, user_agent, expires_at)
     values ($1, $2, $3, $4, $5)`,
    [sessionId, userId, metadata?.ipAddress ?? null, metadata?.userAgent ?? null, expiresAt.toISOString()],
  );
  return sessionId;
}

export async function revokeAuthSession(sessionId: string) {
  await ensureAuthSchema();
  await db.query(
    `update auth_session
     set revoked_at = current_timestamp
     where id = $1 and revoked_at is null`,
    [sessionId],
  );
}

export async function recordSuccessfulLogin(userId: string) {
  await ensureAuthSchema();
  await db.query(
    `update auth_user
     set last_login_at = current_timestamp, updated_at = current_timestamp
     where id = $1`,
    [userId],
  );
}

export async function getAuthSessionContext(sessionId: string, userId: string) {
  await ensureAuthSchema();
  const result = await db.query<AuthSessionRow>(
    `select
       s.id as session_id,
       u.id as user_id,
       u.username,
       u.display_name,
       u.is_active,
       u.must_change_password,
       s.expires_at,
       coalesce(array_remove(array_agg(distinct ur.role_code), null), '{}'::text[]) as roles,
       coalesce(array_remove(array_agg(distinct rp.permission_code), null), '{}'::text[]) as permissions
     from auth_session as s
     join auth_user as u on u.id = s.user_id
     left join auth_user_role as ur on ur.user_id = u.id
     left join auth_role_permission as rp on rp.role_code = ur.role_code
     where s.id = $1
       and s.user_id = $2
       and s.revoked_at is null
       and s.expires_at > current_timestamp
     group by s.id, u.id`,
    [sessionId, userId],
  );

  return result.rowCount ? toSessionContext(result.rows[0]) : null;
}

export async function createCaptchaChallenge(): Promise<SliderCaptchaChallenge> {
  await ensureAuthSchema();
  const id = randomUUID();
  const imageWidth = 420;
  const imageHeight = 210;
  const pieceWidth = 52;
  const pieceHeight = 52;
  const targetX = randomInt(92, imageWidth - pieceWidth - 18);
  const pieceY = randomInt(40, imageHeight - pieceHeight - 16);
  const tolerance = 6;
  const meta: SliderCaptchaMeta = {
    kind: 'slider',
    targetX,
    tolerance,
    pieceWidth,
    pieceHeight,
    pieceY,
    maxOffset: imageWidth - pieceWidth,
    imageWidth,
    imageHeight,
  };
  const images = buildSliderCaptchaImages(meta);
  const expiresAt = new Date(Date.now() + AUTH_CAPTCHA_TTL_MS);
  await db.query(
    `insert into auth_captcha (id, answer_hash, challenge_meta, expires_at)
     values ($1, $2, $3::jsonb, $4)`,
    [id, makeCaptchaHash(String(targetX)), JSON.stringify(meta), expiresAt.toISOString()],
  );

  return {
    kind: 'slider',
    captchaId: id,
    backgroundImage: images.backgroundImage,
    puzzleImage: images.puzzleImage,
    imageWidth,
    imageHeight,
    pieceWidth,
    pieceHeight,
    pieceY,
    maxOffset: meta.maxOffset,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function verifyCaptchaChallenge(captchaId: string, sliderOffset: number): Promise<SliderCaptchaVerification | null> {
  await ensureAuthSchema();
  const result = await db.query<CaptchaRow>(
    `select id, answer_hash, challenge_meta, expires_at, used_at
     from auth_captcha
     where id = $1`,
    [captchaId],
  );

  if (!result.rowCount) return null;
  const row = result.rows[0];
  if (row.used_at || row.expires_at.getTime() <= Date.now()) {
    return null;
  }

  const meta = normalizeSliderCaptchaMeta(row.challenge_meta);
  if (!meta) {
    return null;
  }

  if (makeCaptchaHash(String(meta.targetX)) !== row.answer_hash) {
    return null;
  }

  if (!Number.isFinite(sliderOffset) || Math.abs(Math.round(sliderOffset) - meta.targetX) > meta.tolerance) {
    return null;
  }

  const verificationNonce = randomUUID();
  const verificationExpiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const nextMeta: SliderCaptchaMeta = {
    ...meta,
    verifiedNonceHash: makeCaptchaHash(verificationNonce),
    verificationExpiresAt,
  };

  await db.query(
    `update auth_captcha
     set challenge_meta = $2::jsonb
     where id = $1 and used_at is null`,
    [captchaId, JSON.stringify(nextMeta)],
  );

  return {
    verified: true,
    verificationNonce,
    verificationExpiresAt,
  };
}

export async function consumeCaptchaChallenge(captchaId: string, verificationNonce: string) {
  await ensureAuthSchema();
  const result = await db.query<CaptchaRow>(
    `select id, answer_hash, challenge_meta, expires_at, used_at
     from auth_captcha
     where id = $1`,
    [captchaId],
  );

  if (!result.rowCount) return false;
  const row = result.rows[0];
  if (row.used_at || row.expires_at.getTime() <= Date.now()) {
    return false;
  }

  const meta = normalizeSliderCaptchaMeta(row.challenge_meta);
  if (!meta) {
    return false;
  }

  if (makeCaptchaHash(String(meta.targetX)) !== row.answer_hash) {
    return false;
  }

  if (!meta.verifiedNonceHash || !meta.verificationExpiresAt) {
    return false;
  }

  if (Date.parse(meta.verificationExpiresAt) <= Date.now()) {
    return false;
  }

  if (makeCaptchaHash(verificationNonce) !== meta.verifiedNonceHash) {
    return false;
  }

  await db.query(
    `update auth_captcha
     set used_at = current_timestamp
     where id = $1 and used_at is null`,
    [captchaId],
  );
  return true;
}

export async function getLoginThrottleState(username: string, ipAddress: string): Promise<LoginThrottleState> {
  await ensureAuthSchema();
  const normalizedUsername = normalizeUsername(username);
  const subjects = [
    { scope: 'ip', subject: ipAddress.trim() },
    { scope: 'user', subject: normalizedUsername },
  ].filter((item) => item.subject.length > 0);

  if (!subjects.length) {
    return { failureCount: 0, requiresCaptcha: false };
  }

  const conditions = subjects.map((_, index) => `(scope = $${index * 2 + 1} and subject = $${index * 2 + 2})`).join(' or ');
  const values = subjects.flatMap((item) => [item.scope, item.subject]);
  const result = await db.query<LoginGuardRow>(
    `select scope, subject, failure_count, locked_until, captcha_until, last_failed_at
     from auth_login_guard
     where ${conditions}`,
    values,
  );

  let failureCount = 0;
  let requiresCaptcha = false;
  let lockedUntil: Date | null = null;
  const now = Date.now();

  for (const row of result.rows) {
    const isWindowExpired = row.last_failed_at ? now - row.last_failed_at.getTime() > AUTH_BRUTE_FORCE_WINDOW_MS : true;
    const currentCount = isWindowExpired ? 0 : row.failure_count;
    failureCount = Math.max(failureCount, currentCount);

    if (row.captcha_until && row.captcha_until.getTime() > now) {
      requiresCaptcha = true;
    }
    if (row.locked_until && row.locked_until.getTime() > now) {
      if (!lockedUntil || row.locked_until.getTime() > lockedUntil.getTime()) {
        lockedUntil = row.locked_until;
      }
    }
  }

  return {
    failureCount,
    requiresCaptcha,
    lockedUntil: lockedUntil?.toISOString(),
  };
}

async function upsertLoginGuard(scope: 'ip' | 'user', subject: string) {
  if (!subject) return;

  const result = await db.query<LoginGuardRow>(
    `select scope, subject, failure_count, locked_until, captcha_until, last_failed_at
     from auth_login_guard
     where scope = $1 and subject = $2`,
    [scope, subject],
  );

  const now = new Date();
  const lastFailedAt = result.rows[0]?.last_failed_at;
  const expired = !lastFailedAt || now.getTime() - lastFailedAt.getTime() > AUTH_BRUTE_FORCE_WINDOW_MS;
  const nextFailureCount = expired ? 1 : (result.rows[0]?.failure_count ?? 0) + 1;
  const captchaUntil = nextFailureCount >= AUTH_CAPTCHA_AFTER_FAILURES ? new Date(now.getTime() + AUTH_CAPTCHA_TTL_MS) : null;
  const lockedUntil = nextFailureCount >= AUTH_LOCK_AFTER_FAILURES ? new Date(now.getTime() + AUTH_LOCK_TTL_MS) : null;

  await db.query(
    `insert into auth_login_guard (scope, subject, failure_count, locked_until, captcha_until, last_failed_at, updated_at)
     values ($1, $2, $3, $4, $5, current_timestamp, current_timestamp)
     on conflict (scope, subject)
     do update set
       failure_count = excluded.failure_count,
       locked_until = excluded.locked_until,
       captcha_until = excluded.captcha_until,
       last_failed_at = excluded.last_failed_at,
       updated_at = current_timestamp`,
    [scope, subject, nextFailureCount, lockedUntil?.toISOString() ?? null, captchaUntil?.toISOString() ?? null],
  );
}

export async function recordFailedLogin(username: string, ipAddress: string) {
  await ensureAuthSchema();
  const normalizedUsername = normalizeUsername(username);
  await Promise.all([
    upsertLoginGuard('ip', ipAddress.trim()),
    upsertLoginGuard('user', normalizedUsername),
  ]);
  return getLoginThrottleState(normalizedUsername, ipAddress);
}

export async function clearLoginThrottleState(username: string, ipAddress: string) {
  await ensureAuthSchema();
  const normalizedUsername = normalizeUsername(username);
  await db.query(
    `delete from auth_login_guard
     where (scope = 'ip' and subject = $1)
        or (scope = 'user' and subject = $2)`,
    [ipAddress.trim(), normalizedUsername],
  );
}