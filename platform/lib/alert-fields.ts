import { alertFieldMappingSchema, type AlertFieldPathMode } from '@/lib/alert-field-mapping-schema';
import { getAlertFieldMappings } from '@/lib/alert-field-mappings';

export type AlertFieldDefinition = {
  key: string;
  name: string;
  label: string;
  type: string;
  searchable: boolean;
  aggregatable: boolean;
  defaultSelected: boolean;
  detailOnly: boolean;
  statsKind: 'terms' | 'date_histogram' | 'none';
  aggregationField: string;
  sortField: string;
  queryField: string;
};

function resolveFieldPath(name: string, mode: AlertFieldPathMode) {
  return mode === 'keyword' ? `${name}.keyword` : name;
}

function buildAlertFields(mappings: Awaited<ReturnType<typeof getAlertFieldMappings>>): AlertFieldDefinition[] {
  return alertFieldMappingSchema.map((item) => {
    const name = mappings[item.key];
    return {
      key: item.key,
      name,
      label: item.label,
      type: item.type,
      searchable: item.searchable,
      aggregatable: item.aggregatable,
      defaultSelected: item.defaultSelected,
      detailOnly: item.detailOnly,
      statsKind: item.statsKind,
      aggregationField: resolveFieldPath(name, item.aggregationFieldMode),
      sortField: resolveFieldPath(name, item.sortFieldMode),
      queryField: resolveFieldPath(name, item.queryFieldMode),
    };
  });
}

export async function getAlertFields(): Promise<AlertFieldDefinition[]> {
  const mappings = await getAlertFieldMappings();
  return buildAlertFields(mappings);
}

export async function findAlertField(name: string) {
  const fields = await getAlertFields();
  return fields.find((field) => field.name === name) ?? null;
}
