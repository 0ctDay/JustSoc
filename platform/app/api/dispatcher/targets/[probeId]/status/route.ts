import { NextRequest, NextResponse } from 'next/server';
import { withApiAuth } from '@/lib/auth/http';
import { fetchProbeDispatcherAssetStatus } from '@/lib/probe-dispatcher-client';
import { getProbeDispatcherTargetWithSecrets, touchProbeDispatcherTargetLastSeen } from '@/lib/probe-dispatcher-store';

export const runtime = 'nodejs';

export const GET = withApiAuth(async (_request: NextRequest, { params }: { params: { probeId: string } }) => {
  try {
    const target = await getProbeDispatcherTargetWithSecrets(params.probeId);
    if (!target) {
      return NextResponse.json({ error: 'dispatcher_target_not_found', message: 'dispatcher target not found' }, { status: 404 });
    }
    const result = await fetchProbeDispatcherAssetStatus(target);
    if (result.statusCode >= 200 && result.statusCode < 300) {
      await touchProbeDispatcherTargetLastSeen(target.probeId);
    }
    return NextResponse.json({ probeId: target.probeId, result }, { status: result.statusCode });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'dispatcher_target_status_failed', message }, { status: 502 });
  }
}, { permission: 'dispatcher:view' });
