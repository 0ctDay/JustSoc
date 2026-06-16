import { NextRequest, NextResponse } from 'next/server';
import { getAggregationAgentTaskMapping, upsertAggregationAgentTaskMapping } from '@/lib/aggregation-agent-task-store';

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export async function GET(request: NextRequest) {
  try {
    const bucketKey = normalizeString(request.nextUrl.searchParams.get('bucketKey'));
    if (!bucketKey) {
      return NextResponse.json({ error: 'invalid_bucket_key', message: 'bucketKey is required' }, { status: 400 });
    }

    const mapping = await getAggregationAgentTaskMapping(bucketKey);
    return NextResponse.json({ mapping });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'aggregation_agent_task_read_failed', message }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json() as {
      bucketKey?: unknown;
      taskId?: unknown;
      title?: unknown;
      windowStart?: unknown;
      windowEnd?: unknown;
      srcIp?: unknown;
      selkCategory?: unknown;
    };

    const bucketKey = normalizeString(payload.bucketKey);
    const taskId = normalizeString(payload.taskId);
    const title = normalizeString(payload.title);
    const windowStart = normalizeString(payload.windowStart);
    const windowEnd = normalizeString(payload.windowEnd);
    const srcIp = normalizeString(payload.srcIp);
    const selkCategory = normalizeString(payload.selkCategory);

    if (!bucketKey || !taskId || !title || !windowStart || !windowEnd || !srcIp || !selkCategory) {
      return NextResponse.json({ error: 'invalid_payload', message: 'bucketKey, taskId, title, windowStart, windowEnd, srcIp and selkCategory are required' }, { status: 400 });
    }

    const mapping = await upsertAggregationAgentTaskMapping({
      bucketKey,
      taskId,
      title,
      windowStart,
      windowEnd,
      srcIp,
      selkCategory,
    });
    return NextResponse.json({ mapping });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'aggregation_agent_task_write_failed', message }, { status: 502 });
  }
}
