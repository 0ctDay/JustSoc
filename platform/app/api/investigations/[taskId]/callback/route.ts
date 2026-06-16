import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST() {
  return NextResponse.json({ error: 'disabled', message: 'Agent 调查功能已下线' }, { status: 410 });
}
