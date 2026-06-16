import { NextRequest, NextResponse } from 'next/server';
import { loadAlertDetail } from '@/lib/alert-detail';
import { getPersistedAlertAnalysis } from '@/lib/ai-alert-analysis';

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const detail = await loadAlertDetail(params.id, 'selk-event-*');
    if (!detail) {
      return NextResponse.json({ error: 'log_detail_missing', message: 'Log not found' }, { status: 404 });
    }
    const aiAnalysis = await getPersistedAlertAnalysis(params.id);
    return NextResponse.json({
      ...detail,
      aiAnalysis,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'log_detail_failed', message }, { status: 502 });
  }
}
