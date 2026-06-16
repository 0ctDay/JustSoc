import { NextRequest, NextResponse } from 'next/server';
import { withApiAuth } from '@/lib/auth/http';
import { createAuthUser } from '@/lib/auth/store';

export const runtime = 'nodejs';

export const POST = withApiAuth(async (request: NextRequest) => {
  try {
    const payload = await request.json() as {
      username?: string;
      displayName?: string;
      password?: string;
      roles?: string[];
      isActive?: boolean;
      mustChangePassword?: boolean;
    };

    const user = await createAuthUser({
      username: payload.username ?? '',
      displayName: payload.displayName ?? '',
      password: payload.password ?? '',
      roles: Array.isArray(payload.roles) ? payload.roles : [],
      isActive: payload.isActive,
      mustChangePassword: payload.mustChangePassword,
    });

    return NextResponse.json({ user });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'user_create_failed', message }, { status: 400 });
  }
}, { permission: 'rbac:manage' });
