import { NextRequest, NextResponse } from 'next/server';
import { getOptionalAuthContextFromRequest, toClientSessionSummary } from '@/lib/auth/session';
import { getAuthBootstrapStatus } from '@/lib/auth/store';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const [session, bootstrap] = await Promise.all([
      getOptionalAuthContextFromRequest(request),
      getAuthBootstrapStatus(),
    ]);

    return NextResponse.json({
      requiresSetup: bootstrap.requiresSetup,
      session: toClientSessionSummary(session),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'session_read_failed', message }, { status: 500 });
  }
}