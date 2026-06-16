import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { authErrorToResponse, requireRequestAuth } from '@/lib/auth/http';
import { getAlertFieldMappings, getAlertFieldMappingsConfigPath, putAlertFieldMappings } from '@/lib/alert-field-mappings';
import { alertFieldMappingSchema } from '@/lib/alert-field-mapping-schema';

export const runtime = 'nodejs';

function relativeConfigPath() {
  return path.relative(process.cwd(), getAlertFieldMappingsConfigPath()).replace(/\\/g, '/');
}

export async function GET(request: NextRequest) {
  try {
    await requireRequestAuth(request, 'settings:manage');
    const mappings = await getAlertFieldMappings();
    return NextResponse.json({ mappings, schema: alertFieldMappingSchema, configPath: relativeConfigPath() });
  } catch (error) {
    if (error instanceof Error && ('status' in error || 'code' in error)) {
      return authErrorToResponse(error);
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'alert_field_mappings_read_failed', message }, { status: 502 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireRequestAuth(request, 'settings:manage');
    const payload = await request.json();
    const mappings = await putAlertFieldMappings(payload as Record<string, unknown>);
    return NextResponse.json({ mappings, schema: alertFieldMappingSchema, configPath: relativeConfigPath() });
  } catch (error) {
    if (error instanceof Error && ('status' in error || 'code' in error)) {
      return authErrorToResponse(error);
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'alert_field_mappings_write_failed', message }, { status: 400 });
  }
}