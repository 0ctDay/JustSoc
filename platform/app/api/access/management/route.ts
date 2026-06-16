import { NextResponse } from 'next/server';
import { withApiAuth } from '@/lib/auth/http';
import { listAuthPermissions, listAuthRoles, listAuthUsers } from '@/lib/auth/store';

export const runtime = 'nodejs';

export const GET = withApiAuth(async () => {
  try {
    const [users, roles, permissions] = await Promise.all([
      listAuthUsers(),
      listAuthRoles(),
      listAuthPermissions(),
    ]);
    return NextResponse.json({ users, roles, permissions });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'access_management_read_failed', message }, { status: 500 });
  }
}, { permission: 'rbac:manage' });
