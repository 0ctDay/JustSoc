import { NextRequest, NextResponse } from 'next/server';
import { withApiAuth } from '@/lib/auth/http';
import { upsertAuthRole } from '@/lib/auth/store';

export const runtime = 'nodejs';

export const PATCH = withApiAuth(async (
  request: NextRequest,
  { params }: { params: { roleCode: string } },
) => {
  try {
    const payload = await request.json() as {
      code?: string;
      name?: string;
      description?: string;
      permissions?: string[];
    };

    const role = await upsertAuthRole({
      code: payload.code ?? params.roleCode,
      name: payload.name ?? '',
      description: payload.description ?? '',
      permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
    }, params.roleCode);

    return NextResponse.json({ role });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'role_update_failed', message }, { status: 400 });
  }
}, { permission: 'rbac:manage' });