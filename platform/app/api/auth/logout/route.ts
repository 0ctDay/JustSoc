import { NextRequest, NextResponse } from 'next/server';
import { AUTH_SESSION_COOKIE } from '@/lib/auth/config';
import { clearSessionCookie } from '@/lib/auth/session';
import { revokeAuthSession } from '@/lib/auth/store';
import { verifySessionToken } from '@/lib/auth/token';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const payload = await verifySessionToken(request.cookies.get(AUTH_SESSION_COOKIE)?.value);
    if (payload) {
      await revokeAuthSession(payload.sid);
    }

    const response = NextResponse.json({ ok: true });
    return clearSessionCookie(response, request);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const response = NextResponse.json({ error: 'logout_failed', message }, { status: 500 });
    return clearSessionCookie(response, request);
  }
}