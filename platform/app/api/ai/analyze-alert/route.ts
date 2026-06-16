import { NextRequest, NextResponse } from 'next/server';
import { analyzeAndPersistAlertById, analyzeAndPersistAlerts } from '@/lib/ai-alert-analysis';
import { resolveUserKey } from '@/lib/current-user';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json() as { alertId?: string; alertIds?: string[]; force?: boolean; indexPattern?: string };
    const userKey = resolveUserKey(request.headers);
    const force = payload.force === true;
    const indexPattern = typeof payload.indexPattern === 'string' && /^(selk-suricata-\*|selk-event-\*)$/.test(payload.indexPattern)
      ? payload.indexPattern
      : undefined;

    const alertIds = Array.isArray(payload.alertIds)
      ? payload.alertIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
      : [];

    if (alertIds.length > 0) {
      const summary = await analyzeAndPersistAlerts(alertIds, userKey, { force, concurrency: 3, indexPattern });
      return NextResponse.json(summary);
    }

    const alertId = typeof payload.alertId === 'string' ? payload.alertId.trim() : '';
    if (!alertId) {
      return NextResponse.json({ error: 'invalid_alert_id', message: 'alertId is required' }, { status: 400 });
    }

    const result = await analyzeAndPersistAlertById(alertId, userKey, { force, indexPattern });
    return NextResponse.json({ result: result.analysis, skipped: result.skipped });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message === 'Alert not found' ? 404 : 502;
    return NextResponse.json({ error: 'ai_alert_analysis_failed', message }, { status });
  }
}
