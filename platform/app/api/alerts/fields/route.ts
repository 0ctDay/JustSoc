import { NextResponse } from 'next/server';
import { getAlertFields } from '@/lib/alert-fields';

export const runtime = 'nodejs';

export async function GET() {
  const fields = await getAlertFields();
  return NextResponse.json(fields);
}
