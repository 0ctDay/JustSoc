import { NextRequest, NextResponse } from 'next/server';
import { buildAggregationAgentContext } from '@/lib/aggregation-agent-context';

type AggregationAgentContextRequest = {
  windowStart?: string;
  windowEnd?: string;
  srcIp?: string;
  selkCategory?: string;
  totalAlerts?: number;
  successfulAlerts?: number;
  attackResult?: string;
  title?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as AggregationAgentContextRequest;
    if (!body.windowStart || !body.windowEnd || !body.srcIp || !body.selkCategory || !body.title) {
      return NextResponse.json({ error: 'invalid_request', message: 'windowStart, windowEnd, srcIp, selkCategory and title are required' }, { status: 400 });
    }

    const result = await buildAggregationAgentContext({
      windowStart: body.windowStart,
      windowEnd: body.windowEnd,
      srcIp: body.srcIp,
      selkCategory: body.selkCategory,
      totalAlerts: Number(body.totalAlerts ?? 0),
      successfulAlerts: Number(body.successfulAlerts ?? 0),
      attackResult: typeof body.attackResult === 'string' ? body.attackResult : '',
      title: body.title,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'alerts_aggregations_context_failed', message }, { status: 502 });
  }
}
