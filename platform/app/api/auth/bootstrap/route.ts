import { NextRequest, NextResponse } from 'next/server';
import { applySessionCookie, createUserSession, toClientSessionSummary } from '@/lib/auth/session';
import { bootstrapAdminUser, getAuthBootstrapStatus } from '@/lib/auth/store';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const status = await getAuthBootstrapStatus();
    if (!status.requiresSetup) {
      return NextResponse.json({ error: 'bootstrap_completed', message: '骞冲彴宸插垵濮嬪寲锛屼笉鑳介噸澶嶅垱寤虹鐞嗗憳' }, { status: 409 });
    }

    const payload = await request.json() as { username?: string; displayName?: string; password?: string };
    const profile = await bootstrapAdminUser({
      username: payload.username ?? '',
      displayName: payload.displayName ?? '',
      password: payload.password ?? '',
    });
    const created = await createUserSession(profile, request);
    const response = NextResponse.json({ session: toClientSessionSummary(created.session) });
    return applySessionCookie(response, created.token, created.expiresAt, request);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'bootstrap_failed', message }, { status: 400 });
  }
}
