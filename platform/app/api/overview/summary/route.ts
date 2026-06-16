import { NextResponse } from 'next/server';
import { esRequest } from '@/lib/es';
import { readRuntimeSummary } from '@/lib/runtime-status';

export async function GET() {
  try {
    const [cluster, indices, alerts, runtime] = await Promise.all([
      esRequest('/_cluster/health'),
      esRequest('/_cat/indices/selk-*?format=json&expand_wildcards=all&bytes=b'),
      esRequest('selk-*/_search?ignore_unavailable=true', {
        method: 'POST',
        body: JSON.stringify({
          size: 0,
          query: {
            term: {
              'event_type.keyword': 'alert',
            },
          },
        }),
      }),
      readRuntimeSummary(),
    ]);

    return NextResponse.json({ cluster, indices, alerts, runtime });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'overview_summary_failed', message }, { status: 502 });
  }
}
