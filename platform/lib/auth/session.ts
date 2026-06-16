import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { AUTH_DEFAULT_SESSION_HOURS, AUTH_SESSION_COOKIE } from '@/lib/auth/config';
import { createSessionToken, type SessionTokenPayload, verifySessionToken } from '@/lib/auth/token';
import {
  clearLoginThrottleState,
  createAuthSession,
  getAuthSessionContext,
  recordSuccessfulLogin,
  type AuthSessionContext,
  type AuthUserProfile,
} from '@/lib/auth/store';

export type AuthClientSession = {
  sessionId: string;
  userId: string;
  username: string;
  displayName: string;
  mustChangePassword: boolean;
  expiresAt: string;
  roles: string[];
  permissions: string[];
};

function getSessionDurationHours() {
  const parsed = Number(AUTH_DEFAULT_SESSION_HOURS);
  if (!Number.isFinite(parsed)) return 12;
  return Math.max(1, Math.min(168, parsed));
}

function toClientSession(session: AuthSessionContext): AuthClientSession {
  return {
    sessionId: session.sessionId,
    userId: session.userId,
    username: session.username,
    displayName: session.displayName,
    mustChangePassword: session.mustChangePassword,
    expiresAt: session.expiresAt,
    roles: session.roles,
    permissions: session.permissions,
  };
}

// 是否给会话 cookie 加 Secure 标志。
// 单纯依赖 NODE_ENV=production 会导致：HTTP 部署（无 HTTPS）时浏览器拒绝回传 Secure cookie，
// 登录后所有受保护页面都被重定向回 /login。这里改为按请求实际协议判断，并允许显式覆盖。
function resolveCookieSecure(request?: Request | NextRequest): boolean {
  const override = process.env.SELK_AUTH_COOKIE_SECURE?.trim().toLowerCase();
  if (override === 'true' || override === '1') return true;
  if (override === 'false' || override === '0') return false;

  // auto（默认）：仅当请求确实走 HTTPS（含反向代理转发）时才加 Secure
  if (request) {
    const forwardedProto = request.headers.get('x-forwarded-proto');
    if (forwardedProto) {
      return forwardedProto.split(',')[0]?.trim().toLowerCase() === 'https';
    }
    try {
      return new URL(request.url).protocol === 'https:';
    } catch {
      // ignore, fall through
    }
  }
  return false;
}

function createCookieOptions(expiresAt: Date, secure: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
    expires: expiresAt,
  };
}

async function loadSessionFromTokenPayload(payload: SessionTokenPayload | null) {
  if (!payload) return null;

  const session = await getAuthSessionContext(payload.sid, payload.uid);
  if (!session || !session.isActive) {
    return null;
  }
  return session;
}

export function getRequestIpAddress(request: Request | NextRequest) {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() || 'unknown';
  }

  return request.headers.get('x-real-ip')
    ?? request.headers.get('cf-connecting-ip')
    ?? 'unknown';
}

export function getRequestUserAgent(request: Request | NextRequest) {
  return request.headers.get('user-agent') ?? 'unknown';
}

export async function createUserSession(profile: AuthUserProfile, request: Request | NextRequest) {
  const sessionHours = getSessionDurationHours();
  const expiresAt = new Date(Date.now() + sessionHours * 60 * 60 * 1000);
  const sessionId = await createAuthSession(profile.id, expiresAt, {
    ipAddress: getRequestIpAddress(request),
    userAgent: getRequestUserAgent(request),
  });

  await recordSuccessfulLogin(profile.id);
  await clearLoginThrottleState(profile.username, getRequestIpAddress(request));

  const { token } = await createSessionToken(
    {
      sid: sessionId,
      uid: profile.id,
      username: profile.username,
      displayName: profile.displayName,
      roles: profile.roles,
      permissions: profile.permissions,
    },
    sessionHours,
  );

  const session = await getAuthSessionContext(sessionId, profile.id);
  if (!session) {
    throw new Error('鍒涘缓鐧诲綍浼氳瘽澶辫触');
  }

  return {
    token,
    expiresAt,
    session,
  };
}

export function applySessionCookie(
  response: NextResponse,
  token: string,
  expiresAt: Date,
  request?: Request | NextRequest,
) {
  response.cookies.set(AUTH_SESSION_COOKIE, token, createCookieOptions(expiresAt, resolveCookieSecure(request)));
  return response;
}

export function clearSessionCookie(response: NextResponse, request?: Request | NextRequest) {
  response.cookies.set(AUTH_SESSION_COOKIE, '', {
    ...createCookieOptions(new Date(0), resolveCookieSecure(request)),
    maxAge: 0,
  });
  return response;
}

export async function getOptionalAuthContextFromRequest(request: NextRequest) {
  const payload = await verifySessionToken(request.cookies.get(AUTH_SESSION_COOKIE)?.value);
  return loadSessionFromTokenPayload(payload);
}

export async function getOptionalAuthContextFromCookieValue(cookieValue: string | undefined) {
  const payload = await verifySessionToken(cookieValue);
  return loadSessionFromTokenPayload(payload);
}

export async function getOptionalServerAuthContext() {
  const cookieStore = cookies();
  return getOptionalAuthContextFromCookieValue(cookieStore.get(AUTH_SESSION_COOKIE)?.value);
}

export function toClientSessionSummary(session: AuthSessionContext | null) {
  return session ? toClientSession(session) : null;
}
