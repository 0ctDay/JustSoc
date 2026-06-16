import { NextRequest, NextResponse } from 'next/server';
import { verifyPassword } from '@/lib/auth/password';
import { applySessionCookie, createUserSession, getRequestIpAddress, toClientSessionSummary } from '@/lib/auth/session';
import {
  consumeCaptchaChallenge,
  getAuthBootstrapStatus,
  getLoginThrottleState,
  getUserProfileByUsername,
  recordFailedLogin,
} from '@/lib/auth/store';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const bootstrap = await getAuthBootstrapStatus();
    if (bootstrap.requiresSetup) {
      return NextResponse.json(
        { error: 'bootstrap_required', message: '平台尚未初始化，请先创建管理员账号', requiresSetup: true },
        { status: 409 },
      );
    }

    const payload = await request.json() as {
      username?: string;
      password?: string;
      captchaId?: string;
      captchaNonce?: string;
    };

    const username = typeof payload.username === 'string' ? payload.username.trim() : '';
    const password = typeof payload.password === 'string' ? payload.password : '';
    const captchaId = typeof payload.captchaId === 'string' ? payload.captchaId : '';
    const captchaNonce = typeof payload.captchaNonce === 'string' ? payload.captchaNonce : '';
    const ipAddress = getRequestIpAddress(request);

    if (!username || !password) {
      return NextResponse.json({ error: 'invalid_input', message: '用户名和密码不能为空' }, { status: 400 });
    }

    const throttle = await getLoginThrottleState(username, ipAddress);
    if (throttle.lockedUntil) {
      return NextResponse.json(
        {
          error: 'login_locked',
          message: '登录失败次数过多，请稍后再试',
          requiresCaptcha: true,
          lockedUntil: throttle.lockedUntil,
        },
        { status: 429 },
      );
    }

    const validCaptcha = captchaId && captchaNonce ? await consumeCaptchaChallenge(captchaId, captchaNonce) : false;
    if (!validCaptcha) {
      return NextResponse.json(
        {
          error: 'captcha_required',
          message: '请先完成滑块验证',
          requiresCaptcha: true,
        },
        { status: 400 },
      );
    }

    const profile = await getUserProfileByUsername(username);
    const passwordMatched = profile ? await verifyPassword(password, profile.passwordHash) : false;

    if (!profile || !passwordMatched || !profile.isActive) {
      const nextThrottle = await recordFailedLogin(username, ipAddress);
      return NextResponse.json(
        {
          error: 'invalid_credentials',
          message: '用户名或密码错误',
          requiresCaptcha: true,
          lockedUntil: nextThrottle.lockedUntil,
        },
        { status: nextThrottle.lockedUntil ? 429 : 401 },
      );
    }

    const created = await createUserSession(profile, request);
    const response = NextResponse.json({ session: toClientSessionSummary(created.session) });
    return applySessionCookie(response, created.token, created.expiresAt, request);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'login_failed', message }, { status: 500 });
  }
}