import { NextRequest, NextResponse } from 'next/server';
import { verifyCaptchaChallenge } from '@/lib/auth/store';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json() as {
      captchaId?: string;
      captchaOffset?: number;
    };

    const captchaId = typeof payload.captchaId === 'string' ? payload.captchaId : '';
    const captchaOffset = Number(payload.captchaOffset);

    if (!captchaId || !Number.isFinite(captchaOffset)) {
      return NextResponse.json(
        { error: 'invalid_captcha_payload', message: '验证码参数不完整' },
        { status: 400 },
      );
    }

    const result = await verifyCaptchaChallenge(captchaId, captchaOffset);
    if (!result) {
      return NextResponse.json(
        { error: 'captcha_verify_failed', message: '滑块位置不正确，请重试' },
        { status: 400 },
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'captcha_verify_failed', message }, { status: 500 });
  }
}