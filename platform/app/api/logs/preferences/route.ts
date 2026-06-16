import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureAlertPreferencesTable } from '@/lib/alert-preferences-store';
import { resolveUserKey } from '@/lib/current-user';

export const runtime = 'nodejs';

const PAGE_KEY = 'logs-raw-fields';

type LogPreferences = {
  selectedFields: string[];
  selectedStatsField: string;
  sidebarWidth: number;
  modalWidth: number;
  columnWidths: Record<string, number>;
  readAlertIds: string[];
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeFieldNames(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
        .filter((item, index, array) => array.indexOf(item) === index)
        .slice(0, 80)
    : [];
}

function normalizeColumnWidths(value: unknown) {
  const widths: Record<string, number> = {};
  if (!value || typeof value !== 'object') return widths;
  Object.entries(value as Record<string, unknown>).forEach(([fieldName, width]) => {
    if (fieldName.trim()) {
      widths[fieldName] = clamp(Number(width), 90, 480);
    }
  });
  return widths;
}

function normalizePreferences(input: Partial<LogPreferences> | null | undefined): LogPreferences {
  return {
    selectedFields: normalizeFieldNames(input?.selectedFields),
    selectedStatsField: typeof input?.selectedStatsField === 'string' && input.selectedStatsField.trim() ? input.selectedStatsField.trim() : 'alert.signature',
    sidebarWidth: clamp(Number(input?.sidebarWidth ?? 150), 120, 420),
    modalWidth: clamp(Number(input?.modalWidth ?? 70), 45, 95),
    columnWidths: normalizeColumnWidths(input?.columnWidths),
    readAlertIds: normalizeFieldNames(input?.readAlertIds).slice(-500),
  };
}

export async function GET(request: NextRequest) {
  try {
    await ensureAlertPreferencesTable();
    const userKey = resolveUserKey(request.headers);
    const result = await db.query<{ preferences_json: Partial<LogPreferences> }>(
      'select preferences_json from alert_user_preferences where user_key = $1 and page_key = $2',
      [userKey, PAGE_KEY],
    );
    const preferences = normalizePreferences(result.rowCount ? result.rows[0].preferences_json : undefined);
    return NextResponse.json({ preferences });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'log_preferences_read_failed', message }, { status: 502 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    await ensureAlertPreferencesTable();
    const userKey = resolveUserKey(request.headers);
    const payload = await request.json();
    const preferences = normalizePreferences(payload as Partial<LogPreferences>);
    await db.query(
      `insert into alert_user_preferences (user_key, page_key, preferences_json)
       values ($1, $2, $3::jsonb)
       on conflict (user_key, page_key)
       do update set preferences_json = excluded.preferences_json, updated_at = current_timestamp`,
      [userKey, PAGE_KEY, JSON.stringify(preferences)],
    );
    return NextResponse.json({ preferences });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'log_preferences_write_failed', message }, { status: 502 });
  }
}
