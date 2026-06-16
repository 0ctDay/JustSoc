import { NextRequest, NextResponse } from 'next/server';
import { esRequest } from '@/lib/es';

type DetailRequest = {
  windowStart?: string;
  windowEnd?: string;
  srcIp?: string;
  selkCategory?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as DetailRequest;
    if (!body.windowStart || !body.windowEnd || !body.srcIp || !body.selkCategory) {
      return NextResponse.json({ error: 'invalid_request', message: 'windowStart, windowEnd, srcIp and selkCategory are required' }, { status: 400 });
    }

    const response = await esRequest<{
      hits?: {
        total?: { value?: number; relation?: string };
        hits?: Array<{ _id: string; _index: string; _source?: Record<string, unknown> }>;
      };
    }>('selk-*/_search?ignore_unavailable=true', {
      method: 'POST',
      body: JSON.stringify({
        size: 200,
        track_total_hits: true,
        sort: [{ '@timestamp': { order: 'desc' } }],
        query: {
          bool: {
            filter: [
              { term: { 'event_type.keyword': 'alert' } },
              { range: { '@timestamp': { gte: body.windowStart, lt: body.windowEnd } } },
              { term: { 'selk.src_ip_category.keyword': `${body.srcIp}||${body.selkCategory}` } },
            ],
          },
        },
      }),
    });

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'alerts_aggregations_detail_failed', message }, { status: 502 });
  }
}
