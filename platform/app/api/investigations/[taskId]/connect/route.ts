import { NextRequest, NextResponse } from 'next/server';
import { authErrorToResponse, requireRequestAuth } from '@/lib/auth/http';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    await requireRequestAuth(request, 'investigation:manage');
    return NextResponse.json({ error: 'disabled', message: 'Agent 调查功能已下线' }, { status: 410 });
  } catch (error) {
    return authErrorToResponse(error);
  }
}