import { NextRequest, NextResponse } from 'next/server';
import { esRequest } from '@/lib/es';

type EventTypesRequest = {
  query?: string;
  querySyntax?: string;
  timeRange?: { from?: string; to?: string };
  size?: number;
};

function buildQuery(body: EventTypesRequest) {
  const filter: Array<Record<string, unknown>> = [];

  if (body.timeRange?.from || body.timeRange?.to) {
    const range: Record<string, string> = {};
    if (body.timeRange.from) range.gte = body.timeRange.from;
    if (body.timeRange.to) range.lte = body.timeRange.to;
    filter.push({ range: { '@timestamp': range } });
  }

  const bool: Record<string, unknown> = { filter };

  if (body.query?.trim()) {
    if ((body.querySyntax ?? 'lucene') !== 'lucene') {
      throw new Error('only lucene querySyntax is supported in this stage');
    }
    bool.must = [
      {
        query_string: {
          query: body.query.trim(),
          analyze_wildcard: true,
        },
      },
    ];
  }

  return { bool };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as EventTypesRequest;
    const response = await esRequest<{
      aggregations?: {
        event_types?: {
          buckets?: Array<{ key: string; doc_count: number }>;
        };
      };
    }>('/selk-event-*/_search?ignore_unavailable=true', {
      method: 'POST',
      body: JSON.stringify({
        size: 0,
        query: buildQuery(body),
        aggs: {
          event_types: {
            terms: {
              field: 'event_type.keyword',
              size: Math.max(1, Math.min(200, body.size ?? 100)),
            },
          },
        },
      }),
    });

    return NextResponse.json({
      eventTypes: response.aggregations?.event_types?.buckets ?? [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message.startsWith('only lucene') ? 400 : 502;
    return NextResponse.json({ error: 'log_event_types_failed', message }, { status });
  }
}
