import { NextResponse } from 'next/server';
import type { AlertFieldDefinition } from '@/lib/alert-fields';
import { esRequest } from '@/lib/es';

type FieldCapsResponse = {
  fields?: Record<string, Record<string, {
    searchable?: boolean;
    aggregatable?: boolean;
    type?: string;
  }>>;
};

const DEFAULT_LOG_COLUMNS = ['@timestamp', 'src_ip', 'src_port', 'dest_ip', 'dest_port', 'proto', 'app_proto'];

function pickCapability(caps: Record<string, { searchable?: boolean; aggregatable?: boolean; type?: string }>) {
  const entries = Object.values(caps);
  const keyword = caps.keyword;
  const selected = keyword ?? entries.find((entry) => entry.aggregatable) ?? entries[0];
  return {
    type: selected?.type ?? 'unknown',
    searchable: entries.some((entry) => entry.searchable),
    aggregatable: entries.some((entry) => entry.aggregatable),
  };
}

function statsKind(type: string, aggregatable: boolean): AlertFieldDefinition['statsKind'] {
  if (!aggregatable) return 'none';
  return type === 'date' ? 'date_histogram' : 'terms';
}

function queryField(name: string, type: string) {
  if (name === '@timestamp') return name;
  if (['keyword', 'integer', 'long', 'short', 'byte', 'double', 'float', 'half_float', 'scaled_float', 'boolean', 'date', 'ip'].includes(type)) {
    return name;
  }
  return name;
}

function aggregationField(name: string, type: string, allFieldNames: Set<string>) {
  if (type === 'text' && allFieldNames.has(`${name}.keyword`)) {
    return `${name}.keyword`;
  }
  return name;
}

export async function GET() {
  try {
    const response = await esRequest<FieldCapsResponse>('/selk-event-*/_field_caps?fields=*&ignore_unavailable=true');
    const allFieldNames = new Set(Object.keys(response.fields ?? {}));
    const fields = Object.entries(response.fields ?? {})
      .filter(([name]) => !name.startsWith('_'))
      .sort(([left], [right]) => {
        const leftDefaultIndex = DEFAULT_LOG_COLUMNS.indexOf(left);
        const rightDefaultIndex = DEFAULT_LOG_COLUMNS.indexOf(right);
        if (left === 'alert.signature') return -1;
        if (right === 'alert.signature') return 1;
        if (leftDefaultIndex >= 0 || rightDefaultIndex >= 0) {
          return (leftDefaultIndex >= 0 ? leftDefaultIndex : 999) - (rightDefaultIndex >= 0 ? rightDefaultIndex : 999);
        }
        return left.localeCompare(right);
      })
      .map(([name, caps]): AlertFieldDefinition => {
        const capability = pickCapability(caps);
        const aggregatable = capability.aggregatable || (capability.type === 'text' && allFieldNames.has(`${name}.keyword`));
        return {
          key: name,
          name,
          label: name,
          type: capability.type,
          searchable: capability.searchable,
          aggregatable,
          defaultSelected: DEFAULT_LOG_COLUMNS.includes(name),
          detailOnly: false,
          statsKind: statsKind(capability.type, aggregatable),
          aggregationField: aggregationField(name, capability.type, allFieldNames),
          sortField: aggregationField(name, capability.type, allFieldNames),
          queryField: queryField(name, capability.type),
        };
      });

    if (!fields.some((field) => field.name === 'alert.signature')) {
      fields.unshift({
        key: 'alert.signature',
        name: 'alert.signature',
        label: 'alert.signature',
        type: 'keyword',
        searchable: true,
        aggregatable: true,
        defaultSelected: false,
        detailOnly: false,
        statsKind: 'terms',
        aggregationField: 'alert.signature.keyword',
        sortField: 'alert.signature.keyword',
        queryField: 'alert.signature',
      });
    }

    return NextResponse.json(fields);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'log_fields_failed', message }, { status: 502 });
  }
}
