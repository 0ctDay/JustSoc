import { NextRequest, NextResponse } from 'next/server';
import { withApiAuth } from '@/lib/auth/http';
import { deleteProbeDispatcherTarget, getProbeDispatcherTarget, upsertProbeDispatcherTarget } from '@/lib/probe-dispatcher-store';

export const runtime = 'nodejs';

export const GET = withApiAuth(async (_request: NextRequest, { params }: { params: { probeId: string } }) => {
  try {
    const target = await getProbeDispatcherTarget(params.probeId);
    if (!target) {
      return NextResponse.json({ error: 'dispatcher_target_not_found', message: 'dispatcher target not found' }, { status: 404 });
    }
    return NextResponse.json({ target });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'dispatcher_target_read_failed', message }, { status: 400 });
  }
}, { permission: 'dispatcher:view' });

export const PUT = withApiAuth(async (request: NextRequest, { params }: { params: { probeId: string } }) => {
  try {
    const payload = await request.json() as {
      displayName?: string;
      baseUrl?: string;
      authMode?: 'bearer' | 'hmac';
      hmacKeyId?: string;
      hmacSharedSecret?: string;
      bearerToken?: string;
      enabled?: boolean;
    };

    const target = await upsertProbeDispatcherTarget({
      probeId: params.probeId,
      ...payload,
    });
    return NextResponse.json({ target });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'dispatcher_target_write_failed', message }, { status: 400 });
  }
}, { permission: 'dispatcher:credential:manage' });

export const DELETE = withApiAuth(async (_request: NextRequest, { params }: { params: { probeId: string } }) => {
  try {
    await deleteProbeDispatcherTarget(params.probeId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'dispatcher_target_delete_failed', message }, { status: 400 });
  }
}, { permission: 'dispatcher:credential:manage' });
