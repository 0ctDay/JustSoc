import { NextResponse } from 'next/server';
import { createCaptchaChallenge } from '@/lib/auth/store';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const payload = await createCaptchaChallenge();
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'captcha_create_failed', message }, { status: 500 });
  }
}
