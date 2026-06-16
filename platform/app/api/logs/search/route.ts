import { NextRequest, NextResponse } from 'next/server';
import { esRequest } from '@/lib/es';

type SearchRequest = {
  query?: string;
  querySyntax?: string;
  timeRange?: { from?: string; to?: string };
  eventTypes?: string[];
  page?: { from?: number; size?: number };
  sort?: Array<{ field?: string; order?: 'asc' | 'desc' }>;
  statsField?: string;
  statsSize?: number;
};

type FieldCapsResponse = {
  fields?: Record<string, Record<string, {
    searchable?: boolean;
    aggregatable?: boolean;
    type?: string;
  }>>;
};

type RuntimeField = {
  name: string;
  type: string;
  aggregatable: boolean;
  aggregationField: string;
  sortField: string;
  statsKind: 'terms' | 'date_histogram' | 'none';
};

async function loadRuntimeFields() {
  const response = await esRequest<FieldCapsResponse>('/selk-event-*/_field_caps?fields=*&ignore_unavailable=true');
  const allFieldNames = new Set(Object.keys(response.fields ?? {}));
  const map = new Map<string, RuntimeField>();

  Object.entries(response.fields ?? {}).forEach(([name, caps]) => {
    const entries = Object.values(caps);
    const keyword = caps.keyword;
    const selected = keyword ?? entries.find((entry) => entry.aggregatable) ?? entries[0];
    const type = selected?.type ?? 'unknown';
    const aggregationField = type === 'text' && allFieldNames.has(`${name}.keyword`) ? `${name}.keyword` : name;
    const aggregatable = entries.some((entry) => entry.aggregatable) || aggregationField !== name;
    map.set(name, {
      name,
      type,
      aggregatable,
      aggregationField,
      sortField: aggregationField,
      statsKind: !aggregatable ? 'none' : type === 'date' ? 'date_histogram' : 'terms',
    });
  });

  if (!map.has('alert.signature')) {
    map.set('alert.signature', {
      name: 'alert.signature',
      type: 'keyword',
      aggregatable: true,
      aggregationField: 'alert.signature.keyword',
      sortField: 'alert.signature.keyword',
      statsKind: 'terms',
    });
  }

  return map;
}

function buildSort(sort: SearchRequest['sort'], fields: Map<string, RuntimeField>) {
  if (!sort?.length) {
    return [{ '@timestamp': { order: 'desc' } }];
  }

  return sort
    .filter((item) => item.field)
    .map((item) => {
      const field = fields.get(item.field!);
      return {
        [(field?.sortField ?? item.field!)]: {
          order: item.order === 'asc' ? 'asc' : 'desc',
        },
      };
    });
}

function normalizeEventTypes(eventTypes: unknown) {
  if (!Array.isArray(eventTypes)) {
    return [];
  }
  return eventTypes
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value, index, array) => value.length > 0 && array.indexOf(value) === index)
    .slice(0, 100);
}

function buildQuery(body: SearchRequest) {
  const filter: Array<Record<string, unknown>> = [];
  const eventTypes = normalizeEventTypes(body.eventTypes);

  if (eventTypes.length > 0) {
    filter.push({ terms: { 'event_type.keyword': eventTypes } });
  }

  if (body.timeRange?.from || body.timeRange?.to) {
    const range: Record<string, string> = {};
    if (body.timeRange.from) range.gte = body.timeRange.from;
    if (body.timeRange.to) range.lte = body.timeRange.to;
    filter.push({ range: { '@timestamp': range } });
  }

  const bool: Record<string, unknown> = { filter };

  if (body.query?.trim()) {
    if ((body.querySyntax ?? 'lucene') !== 'lucene') {
      throw new Error('only lucene querySyntax is supported in this stage');
    }
    bool.must = [
      {
        query_string: {
          query: body.query.trim(),
          analyze_wildcard: true,
        },
      },
    ];
  }

  return { bool };
}

function buildAggs(body: SearchRequest, fields: Map<string, RuntimeField>) {
  if (!body.statsField) {
    return undefined;
  }

  const field = fields.get(body.statsField);
  if (!field) {
    throw new Error(`unknown stats field: ${body.statsField}`);
  }
  if (!field.aggregatable) {
    throw new Error(`field is not aggregatable: ${body.statsField}`);
  }

  if (field.statsKind === 'date_histogram') {
    return {
      field_missing: { missing: { field: field.aggregationField } },
      field_histogram: {
        date_histogram: {
          field: field.aggregationField,
          fixed_interval: '1h',
          min_doc_count: 0,
        },
      },
    };
  }

  return {
    field_missing: { missing: { field: field.aggregationField } },
    field_cardinality: { cardinality: { field: field.aggregationField } },
    field_terms: {
      terms: {
        field: field.aggregationField,
        size: Math.max(1, Math.min(20, body.statsSize ?? 8)),
      },
    },
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as SearchRequest;
    const fields = await loadRuntimeFields();
    const aggs = buildAggs(body, fields);
    const payload = {
      track_total_hits: true,
      from: Math.max(0, body.page?.from ?? 0),
      size: Math.max(1, Math.min(200, body.page?.size ?? 25)),
      sort: buildSort(body.sort, fields),
      query: buildQuery(body),
      ...(aggs ? { aggs } : {}),
    };

    const response = await esRequest('/selk-event-*/_search?ignore_unavailable=true', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message.startsWith('unknown stats field') || message.startsWith('field is not aggregatable') || message.startsWith('only lucene') ? 400 : 502;
    return NextResponse.json({ error: 'logs_search_failed', message }, { status });
  }
}
