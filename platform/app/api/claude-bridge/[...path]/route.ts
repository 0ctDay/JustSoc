import { NextRequest, NextResponse } from 'next/server';
import { authErrorToResponse, requireRequestAuth } from '@/lib/auth/http';
import { buildClaudeCodeBridgeRuntimeConfig } from '@/lib/claude-code-bridge-config';
import { CLAUDE_BRIDGE_BASE_URL } from '@/lib/claude-code-bridge-endpoint';
import { getClaudeCodeBridgeSettings } from '@/lib/claude-code-bridge-settings';

export const runtime = 'nodejs';

function buildUpstreamUrl(baseUrl: string, pathParts: string[], search: string) {
  const sanitizedBase = baseUrl.replace(/\/+$/, '');
  const sanitizedPath = pathParts.map((part) => encodeURIComponent(part)).join('/');
  return `${sanitizedBase}/api/${sanitizedPath}${search}`;
}

async function proxyRequest(request: NextRequest, pathParts: string[]) {
  try {
    await requireRequestAuth(request, 'bridge:manage');
    const settings = await getClaudeCodeBridgeSettings();
    const upstreamUrl = buildUpstreamUrl(CLAUDE_BRIDGE_BASE_URL, pathParts, request.nextUrl.search);
    const method = request.method.toUpperCase();

    let bodyText: string | undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      bodyText = await request.text();
    }

    let upstreamBody = bodyText;
    if (bodyText && method === 'POST') {
      const routeKey = pathParts.join('/');
      if (routeKey === 'tasks' || /tasks\/[^/]+\/messages$/.test(routeKey)) {
        const parsed = JSON.parse(bodyText) as Record<string, unknown>;
        upstreamBody = JSON.stringify({
          ...parsed,
          config: buildClaudeCodeBridgeRuntimeConfig(settings),
        });
      }
    }

    const upstreamResponse = await fetch(upstreamUrl, {
      method,
      headers: {
        'Content-Type': method === 'GET' || method === 'HEAD' ? 'application/json' : 'application/json; charset=utf-8',
      },
      body: method === 'GET' || method === 'HEAD' ? undefined : upstreamBody,
      cache: 'no-store',
    });

    const contentType = upstreamResponse.headers.get('content-type') ?? 'application/json; charset=utf-8';
    const responseHeaders = new Headers({
      'Content-Type': contentType,
      'Cache-Control': upstreamResponse.headers.get('cache-control') ?? 'no-store',
    });

    if (contentType.includes('text/event-stream')) {
      responseHeaders.set('Connection', 'keep-alive');
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  } catch (error) {
    if (error instanceof Error && ('status' in error || 'code' in error)) {
      return authErrorToResponse(error);
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = error instanceof SyntaxError || message.includes('missing required environment') ? 400 : 502;
    return NextResponse.json({ error: 'claude_bridge_proxy_failed', message }, { status });
  }
}

export async function GET(request: NextRequest, { params }: { params: { path: string[] } }) {
  return proxyRequest(request, params.path ?? []);
}

export async function POST(request: NextRequest, { params }: { params: { path: string[] } }) {
  return proxyRequest(request, params.path ?? []);
}

export async function DELETE(request: NextRequest, { params }: { params: { path: string[] } }) {
  return proxyRequest(request, params.path ?? []);
}
