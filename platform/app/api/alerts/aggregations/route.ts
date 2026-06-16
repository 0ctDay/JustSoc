import { NextRequest, NextResponse } from 'next/server';

import { esRequest } from '@/lib/es';

type AggregationRequest = {
  query?: string;
  querySyntax?: string;
  timeRange?: { from?: string; to?: string };
  windowMinutes?: number;
  size?: number;
};

type AggregationBucket = {
  key_as_string?: string;
  key?: number;
  by_src_ip_category?: {
    buckets?: Array<{
      key?: string;
      doc_count?: number;
      successful_alerts?: { doc_count?: number };
    }>;
  };
};

function normalizeWindowMinutes(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 5;
  return Math.max(1, Math.min(1440, Math.floor(num)));
}

function normalizeSize(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 200;
  return Math.max(1, Math.min(500, Math.floor(num)));
}

function toAttackResult(successfulAlerts: number) {
  return successfulAlerts > 0 ? '成功' : '未成功';
}

function splitSrcIpCategory(value: string) {
  const [srcIp = '', ...rest] = value.split('||');
  return {
    srcIp,
    selkCategory: rest.join('||'),
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as AggregationRequest;
    const from = body.timeRange?.from;
    const to = body.timeRange?.to;
    const windowMinutes = normalizeWindowMinutes(body.windowMinutes);
    const size = normalizeSize(body.size);

    const filter: Array<Record<string, unknown>> = [
      { term: { 'event_type.keyword': 'alert' } },
      { exists: { field: 'selk.src_ip_category' } },
    ];

    if (from || to) {
      const range: Record<string, string> = {};
      if (from) range.gte = from;
      if (to) range.lte = to;
      filter.push({ range: { '@timestamp': range } });
    }

    const bool: Record<string, unknown> = { filter };
    if (body.query?.trim()) {
      if ((body.querySyntax ?? 'lucene') !== 'lucene') {
        throw new Error('only lucene querySyntax is supported in this stage');
      }
      bool.must = [{ query_string: { query: body.query.trim(), analyze_wildcard: true } }];
    }

    const response = await esRequest<{
      aggregations?: {
        by_window?: {
          buckets?: AggregationBucket[];
        };
      };
    }>('/selk-*/_search?ignore_unavailable=true', {
      method: 'POST',
      body: JSON.stringify({
        size: 0,
        query: { bool },
        aggs: {
          by_window: {
            date_histogram: {
              field: '@timestamp',
              fixed_interval: `${windowMinutes}m`,
              min_doc_count: 1,
            },
            aggs: {
              by_src_ip_category: {
                terms: {
                  field: 'selk.src_ip_category.keyword',
                  size,
                },
                aggs: {
                  successful_alerts: {
                    filter: {
                      term: { 'engine.attack_success': true },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    });

    const items: Array<{
      bucketKey: string;
      windowStart: string;
      windowEnd: string;
      srcIp: string;
      selkCategory: string;
      totalAlerts: number;
      successfulAlerts: number;
      attackResult: string;
      title: string;
    }> = [];

    for (const windowBucket of response.aggregations?.by_window?.buckets ?? []) {
      const windowStart = String(windowBucket.key_as_string ?? '');
      const windowStartMs = typeof windowBucket.key === 'number' ? windowBucket.key : Date.parse(windowStart);
      const windowEnd = Number.isFinite(windowStartMs)
        ? new Date(windowStartMs + windowMinutes * 60 * 1000).toISOString()
        : '';

      for (const srcCategoryBucket of windowBucket.by_src_ip_category?.buckets ?? []) {
        const combined = String(srcCategoryBucket.key ?? '');
        const { srcIp, selkCategory } = splitSrcIpCategory(combined);
        const totalAlerts = Number(srcCategoryBucket.doc_count ?? 0);
        const successfulAlerts = Number(srcCategoryBucket.successful_alerts?.doc_count ?? 0);
        const attackResult = toAttackResult(successfulAlerts);

        items.push({
          bucketKey: `${windowStart}|${combined}`,
          windowStart,
          windowEnd,
          srcIp,
          selkCategory,
          totalAlerts,
          successfulAlerts,
          attackResult,
          title: `源 IP ${srcIp} 发起 ${selkCategory} 攻击，攻击结果 ${attackResult}`,
        });
      }
    }

    items.sort((a, b) => {
      const left = Date.parse(a.windowStart);
      const right = Date.parse(b.windowStart);
      return right - left || b.totalAlerts - a.totalAlerts;
    });

    return NextResponse.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'alerts_aggregations_failed', message }, { status: 502 });
  }
}
