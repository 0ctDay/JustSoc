import { NextRequest, NextResponse } from 'next/server';
import { getAlertPreferences, putAlertPreferences } from '@/lib/alert-preferences-store';
import { resolveUserKey } from '@/lib/current-user';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const userKey = resolveUserKey(request.headers);
    const preferences = await getAlertPreferences(userKey);
    return NextResponse.json({ preferences });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'alert_preferences_read_failed', message }, { status: 502 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const userKey = resolveUserKey(request.headers);
    const payload = await request.json();
    const preferences = await putAlertPreferences(userKey, payload as Record<string, unknown>);
    return NextResponse.json({ preferences });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'alert_preferences_write_failed', message }, { status: 502 });
  }
}
