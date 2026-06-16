import { db } from '@/lib/db';
import { getAlertFields } from '@/lib/alert-fields';
import { getAlertFieldMappings } from '@/lib/alert-field-mappings';
import { ALERT_TITLE_FIELD_KEY, alertFieldMappingSchema, type AlertFieldMappings } from '@/lib/alert-field-mapping-schema';

export type AlertPreferences = {
  selectedFields: string[];
  selectedStatsField: string;
  sidebarWidth: number;
  modalWidth: number;
  modalHeight: number;
  columnWidths: Record<string, number>;
  readAlertIds: string[];
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getTitleFieldName(mappings: AlertFieldMappings) {
  return mappings[ALERT_TITLE_FIELD_KEY];
}

export async function ensureAlertPreferencesTable() {
  await db.query(`
    create table if not exists alert_user_preferences (
      user_key text not null,
      page_key text not null,
      preferences_json jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp,
      primary key (user_key, page_key)
    )
  `);
}

async function createDefaultPreferences(): Promise<AlertPreferences> {
  const [fields, mappings] = await Promise.all([getAlertFields(), getAlertFieldMappings()]);
  const titleFieldName = getTitleFieldName(mappings);
  return {
    selectedFields: fields.filter((field) => field.defaultSelected && field.name !== titleFieldName).map((field) => field.name),
    selectedStatsField: titleFieldName,
    sidebarWidth: 150,
    modalWidth: 70,
    modalHeight: 70,
    columnWidths: {
      [titleFieldName]: 260,
    },
    readAlertIds: [],
  };
}

function createFieldAliasMap(mappings: AlertFieldMappings) {
  const aliases = new Map<string, string>();
  for (const item of alertFieldMappingSchema) {
    const currentName = mappings[item.key];
    aliases.set(currentName, currentName);
    aliases.set(item.defaultValue, currentName);
    item.legacyAliases?.forEach((alias) => aliases.set(alias, currentName));
  }
  return aliases;
}

export async function normalizeAlertPreferences(input: Partial<AlertPreferences> | null | undefined): Promise<AlertPreferences> {
  const [fields, mappings, defaultPreferences] = await Promise.all([
    getAlertFields(),
    getAlertFieldMappings(),
    createDefaultPreferences(),
  ]);

  const titleFieldName = getTitleFieldName(mappings);
  const validFields = new Set(fields.filter((field) => !field.detailOnly && field.name !== titleFieldName).map((field) => field.name));
  const aggregatableFields = new Set(fields.filter((field) => field.aggregatable).map((field) => field.name));
  const aliases = createFieldAliasMap(mappings);
  const normalizeFieldAlias = (fieldName: string) => aliases.get(fieldName) ?? fieldName;

  const selectedFields = Array.isArray(input?.selectedFields)
    ? input.selectedFields
        .map(normalizeFieldAlias)
        .filter((fieldName, index, array) => validFields.has(fieldName) && array.indexOf(fieldName) === index)
    : defaultPreferences.selectedFields;

  const normalizedStatsField = typeof input?.selectedStatsField === 'string'
    ? normalizeFieldAlias(input.selectedStatsField)
    : undefined;

  const selectedStatsField = normalizedStatsField && aggregatableFields.has(normalizedStatsField)
    ? normalizedStatsField
    : defaultPreferences.selectedStatsField;

  const columnWidths: Record<string, number> = {
    [titleFieldName]: clamp(Number(input?.columnWidths?.[titleFieldName] ?? input?.columnWidths?.['alert.signature'] ?? defaultPreferences.columnWidths[titleFieldName]), 120, 480),
  };

  if (input?.columnWidths) {
    Object.entries(input.columnWidths).forEach(([fieldName, width]) => {
      const normalizedFieldName = normalizeFieldAlias(fieldName);
      if (normalizedFieldName !== titleFieldName && validFields.has(normalizedFieldName)) {
        columnWidths[normalizedFieldName] = clamp(Number(width), 90, 420);
      }
    });
  }

  const readAlertIds = Array.isArray(input?.readAlertIds)
    ? input.readAlertIds
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .slice(-500)
    : defaultPreferences.readAlertIds;

  return {
    selectedFields: selectedFields.length ? selectedFields : defaultPreferences.selectedFields,
    selectedStatsField,
    sidebarWidth: clamp(Number(input?.sidebarWidth ?? defaultPreferences.sidebarWidth), 120, 420),
    modalWidth: clamp(Number(input?.modalWidth ?? defaultPreferences.modalWidth), 45, 95),
    modalHeight: clamp(Number(input?.modalHeight ?? defaultPreferences.modalHeight), 45, 95),
    columnWidths,
    readAlertIds,
  };
}

export async function getAlertPreferences(userKey: string, pageKey = 'alerts') {
  await ensureAlertPreferencesTable();
  const result = await db.query<{ preferences_json: Partial<AlertPreferences> }>(
    'select preferences_json from alert_user_preferences where user_key = $1 and page_key = $2',
    [userKey, pageKey],
  );

  if (!result.rowCount) {
    return normalizeAlertPreferences(undefined);
  }

  return normalizeAlertPreferences(result.rows[0].preferences_json);
}

export async function putAlertPreferences(userKey: string, preferences: Partial<AlertPreferences>, pageKey = 'alerts') {
  await ensureAlertPreferencesTable();
  const normalized = await normalizeAlertPreferences(preferences);
  await db.query(
    `insert into alert_user_preferences (user_key, page_key, preferences_json)
     values ($1, $2, $3::jsonb)
     on conflict (user_key, page_key)
     do update set preferences_json = excluded.preferences_json, updated_at = current_timestamp`,
    [userKey, pageKey, JSON.stringify(normalized)],
  );
  return normalized;
}
