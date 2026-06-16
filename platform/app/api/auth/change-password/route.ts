import { NextRequest, NextResponse } from 'next/server';
import { withApiAuth } from '@/lib/auth/http';
import { changeOwnPassword } from '@/lib/auth/store';

export const runtime = 'nodejs';

export const POST = withApiAuth(async (request: NextRequest, _context, auth) => {
  try {
    const payload = await request.json() as {
      currentPassword?: string;
      newPassword?: string;
    };

    const currentPassword = typeof payload.currentPassword === 'string' ? payload.currentPassword : '';
    const newPassword = typeof payload.newPassword === 'string' ? payload.newPassword : '';

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: 'invalid_password_payload', message: '当前密码和新密码不能为空' },
        { status: 400 },
      );
    }

    await changeOwnPassword(auth.userId, auth.sessionId, currentPassword, newPassword);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'change_password_failed', message }, { status: 400 });
  }
});