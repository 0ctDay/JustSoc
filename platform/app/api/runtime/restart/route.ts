import { NextRequest, NextResponse } from 'next/server';
import { authErrorToResponse, requireRequestAuth } from '@/lib/auth/http';
import { sendProbeDispatcherRequest } from '@/lib/probe-dispatcher-client';
import { getPrimaryProbeDispatcherTargetWithSecrets } from '@/lib/probe-dispatcher-store';

const DEFAULT_CONTROL_PATH = process.env.SELK_RUNTIME_MONITOR_CONTROL_PATH ?? '/_selk_internal/v1/control-plane/9f3a7c4e61/restart';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    await requireRequestAuth(request, 'runtime:restart');
    const body = await request.json() as { target?: string; reason?: string };
    const target = typeof body.target === 'string' ? body.target.trim().toLowerCase() : '';
    const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'platform-overview';

    if (!['probe', 'engine', 'all'].includes(target)) {
      return NextResponse.json({ error: 'invalid_target', message: 'target must be probe, engine, or all' }, { status: 400 });
    }

    const primaryProbe = await getPrimaryProbeDispatcherTargetWithSecrets();
    if (!primaryProbe) {
      return NextResponse.json({ error: 'no_probe_configured', message: '未配置探针：请先在设置中新增探针' }, { status: 400 });
    }

    const { statusCode, payload } = await sendProbeDispatcherRequest(
      primaryProbe,
      DEFAULT_CONTROL_PATH,
      'POST',
      { action: 'restart', target, reason },
    );

    if (statusCode < 200 || statusCode >= 300) {
      return NextResponse.json(
        { error: 'runtime_restart_failed', message: payload.message ?? payload.error ?? `runtime control failed with ${statusCode}` },
        { status: statusCode },
      );
    }

    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof Error && ('status' in error || 'code' in error)) {
      return authErrorToResponse(error);
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'runtime_restart_failed', message }, { status: 502 });
  }
}
