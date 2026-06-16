import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json() as {
      aiBaseUrl?: string;
      aiApiKey?: string;
      aiModel?: string;
    };

    const aiBaseUrl = typeof payload.aiBaseUrl === 'string' ? payload.aiBaseUrl.trim().replace(/\/+$/, '') : '';
    const aiApiKey = typeof payload.aiApiKey === 'string' ? payload.aiApiKey.trim() : '';
    const aiModel = typeof payload.aiModel === 'string' ? payload.aiModel.trim() : '';

    if (!aiBaseUrl) {
      return NextResponse.json({ error: 'invalid_ai_base_url', message: 'AI HTTP 鍦板潃涓嶈兘涓虹┖' }, { status: 400 });
    }
    if (!aiApiKey) {
      return NextResponse.json({ error: 'invalid_ai_api_key', message: 'AI SK 涓嶈兘涓虹┖' }, { status: 400 });
    }
    if (!aiModel) {
      return NextResponse.json({ error: 'invalid_ai_model', message: '妯″瀷涓嶈兘涓虹┖' }, { status: 400 });
    }

    const response = await fetch(`${aiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aiApiKey}`,
      },
      body: JSON.stringify({
        model: aiModel,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content: 'You are a concise assistant. Reply with a short hello-world style acknowledgement in Chinese.',
          },
          {
            role: 'user',
            content: 'Hello world',
          },
        ],
      }),
      cache: 'no-store',
    });

    const text = await response.text();
    const parsed = text ? JSON.parse(text) : {};
    if (!response.ok) {
      return NextResponse.json(
        { error: 'ai_test_failed', message: (parsed && typeof parsed === 'object' && 'error' in parsed) ? JSON.stringify((parsed as Record<string, unknown>).error) : `AI request failed with ${response.status}` },
        { status: 502 },
      );
    }

    const reply = parsed?.choices?.[0]?.message?.content;
    if (typeof reply !== 'string' || !reply.trim()) {
      return NextResponse.json({ error: 'ai_test_failed', message: 'AI 娴嬭瘯杩斿洖鍐呭涓虹┖' }, { status: 502 });
    }

    return NextResponse.json({ reply: reply.trim() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'ai_test_failed', message }, { status: 502 });
  }
}
