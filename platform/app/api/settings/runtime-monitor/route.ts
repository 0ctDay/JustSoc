import { NextRequest, NextResponse } from 'next/server';
import { authErrorToResponse, requireRequestAuth } from '@/lib/auth/http';
import { getRuntimeMonitorSettings, putRuntimeMonitorSettings, sanitizeRuntimeMonitorSettingsForClient } from '@/lib/runtime-monitor-settings';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    await requireRequestAuth(request, 'settings:manage');
    const settings = await getRuntimeMonitorSettings();
    return NextResponse.json({ settings: sanitizeRuntimeMonitorSettingsForClient(settings) });
  } catch (error) {
    if (error instanceof Error && ('status' in error || 'code' in error)) {
      return authErrorToResponse(error);
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'runtime_monitor_settings_read_failed', message }, { status: 502 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireRequestAuth(request, 'settings:manage');
    const payload = await request.json();
    const settings = await putRuntimeMonitorSettings(payload as Record<string, unknown>);
    return NextResponse.json({ settings: sanitizeRuntimeMonitorSettingsForClient(settings) });
  } catch (error) {
    if (error instanceof Error && ('status' in error || 'code' in error)) {
      return authErrorToResponse(error);
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'runtime_monitor_settings_write_failed', message }, { status: 400 });
  }
}
