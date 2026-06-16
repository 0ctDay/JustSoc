import { NextRequest, NextResponse } from 'next/server';
import { authErrorToResponse, requireRequestAuth } from '@/lib/auth/http';
import { esRequest } from '@/lib/es';

export async function GET(request: NextRequest) {
  try {
    await requireRequestAuth(request, 'workspace:view');
    const { searchParams } = new URL(request.url);
    const size = Math.max(1, Math.min(100, Number(searchParams.get('size') ?? '20')));
    const response = await esRequest('selk-*/_search?ignore_unavailable=true', {
      method: 'POST',
      body: JSON.stringify({
        size: 0,
        aggs: {
          top_src_assets: {
            terms: {
              field: 'src_ip.keyword',
              size,
            },
            aggs: {
              latest: {
                top_hits: {
                  size: 1,
                  sort: [{ '@timestamp': { order: 'desc' } }],
                },
              },
            },
          },
        },
      }),
    });

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof Error && ('status' in error || 'code' in error)) {
      return authErrorToResponse(error);
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'assets_list_failed', message }, { status: 502 });
  }
}
