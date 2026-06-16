import { NextRequest, NextResponse } from 'next/server';
import { withApiAuth } from '@/lib/auth/http';
import { updateAuthUser } from '@/lib/auth/store';

export const runtime = 'nodejs';

export const PATCH = withApiAuth(async (
  request: NextRequest,
  { params }: { params: { userId: string } },
) => {
  try {
    const payload = await request.json() as {
      displayName?: string;
      password?: string;
      roles?: string[];
      isActive?: boolean;
      mustChangePassword?: boolean;
    };

    const user = await updateAuthUser(params.userId, {
      displayName: payload.displayName,
      password: payload.password,
      roles: Array.isArray(payload.roles) ? payload.roles : undefined,
      isActive: payload.isActive,
      mustChangePassword: payload.mustChangePassword,
    });

    return NextResponse.json({ user });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'user_update_failed', message }, { status: 400 });
  }
}, { permission: 'rbac:manage' });