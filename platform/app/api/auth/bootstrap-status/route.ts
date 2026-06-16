import { NextResponse } from 'next/server';
import { getAuthBootstrapStatus } from '@/lib/auth/store';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const status = await getAuthBootstrapStatus();
    return NextResponse.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'bootstrap_status_failed', message }, { status: 500 });
  }
}