import { NextRequest, NextResponse } from 'next/server';
import { withApiAuth } from '@/lib/auth/http';
import { listProbeDispatcherTargets, upsertProbeDispatcherTarget } from '@/lib/probe-dispatcher-store';

export const runtime = 'nodejs';

export const GET = withApiAuth(async () => {
  try {
    const targets = await listProbeDispatcherTargets();
    return NextResponse.json({ targets });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'dispatcher_targets_read_failed', message }, { status: 500 });
  }
}, { permission: 'dispatcher:view' });

export const POST = withApiAuth(async (request: NextRequest) => {
  try {
    const payload = await request.json() as {
      probeId?: string;
      displayName?: string;
      baseUrl?: string;
      authMode?: 'bearer' | 'hmac';
      hmacKeyId?: string;
      hmacSharedSecret?: string;
      bearerToken?: string;
      enabled?: boolean;
    };

    const target = await upsertProbeDispatcherTarget(payload);
    return NextResponse.json({ target });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'dispatcher_target_write_failed', message }, { status: 400 });
  }
}, { permission: 'dispatcher:credential:manage' });
