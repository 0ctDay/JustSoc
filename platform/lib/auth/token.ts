import { AUTH_DEFAULT_SESSION_HOURS } from '@/lib/auth/config';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
let cachedAuthSecret: string | null = null;

export type SessionTokenPayload = {
  v: 1;
  sid: string;
  uid: string;
  username: string;
  displayName: string;
  roles: string[];
  permissions: string[];
  exp: number;
};

function getAuthSecret() {
  if (cachedAuthSecret) {
    return cachedAuthSecret;
  }

  const directSecret = process.env.SELK_AUTH_SECRET?.trim();
  if (directSecret) {
    if (directSecret.length < 24) {
      throw new Error('SELK_AUTH_SECRET must be at least 24 characters long');
    }
    cachedAuthSecret = directSecret;
    return cachedAuthSecret;
  }

  throw new Error('SELK_AUTH_SECRET must be configured');
}

function toBase64(bytes: Uint8Array) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }

  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function fromBase64(value: string) {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(value, 'base64'));
  }

  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function toBase64Url(bytes: Uint8Array) {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  return fromBase64(padded);
}

async function signValue(value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(getAuthSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return toBase64Url(new Uint8Array(signature));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
}

function normalizePayload(payload: Omit<SessionTokenPayload, 'v' | 'exp'>, sessionHours?: number): SessionTokenPayload {
  const safeHours = Number.isFinite(sessionHours) && (sessionHours ?? 0) > 0 ? Number(sessionHours) : AUTH_DEFAULT_SESSION_HOURS;
  return {
    v: 1,
    ...payload,
    exp: Math.floor(Date.now() / 1000) + safeHours * 60 * 60,
  };
}

export async function createSessionToken(payload: Omit<SessionTokenPayload, 'v' | 'exp'>, sessionHours?: number) {
  const normalized = normalizePayload(payload, sessionHours);
  const body = toBase64Url(encoder.encode(JSON.stringify(normalized)));
  const signature = await signValue(body);
  return {
    token: `${body}.${signature}`,
    payload: normalized,
  };
}

export async function verifySessionToken(token: string | undefined | null): Promise<SessionTokenPayload | null> {
  if (!token) return null;

  const [body, signature] = token.split('.');
  if (!body || !signature) return null;

  const expected = await signValue(body);
  const expectedBytes = fromBase64Url(expected);
  const actualBytes = fromBase64Url(signature);
  if (!constantTimeEqual(expectedBytes, actualBytes)) {
    return null;
  }

  try {
    const decoded = JSON.parse(decoder.decode(fromBase64Url(body))) as SessionTokenPayload;
    if (decoded.v !== 1 || typeof decoded.exp !== 'number' || decoded.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }
    if (!decoded.sid || !decoded.uid || !decoded.username) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}
