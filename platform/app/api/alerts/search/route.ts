import { NextRequest, NextResponse } from 'next/server';
import { getAlertFields, type AlertFieldDefinition } from '@/lib/alert-fields';
import { esRequest } from '@/lib/es';

export const runtime = 'nodejs';

type SearchRequest = {
  query?: string;
  querySyntax?: string;
  timeRange?: { from?: string; to?: string };
  page?: { from?: number; size?: number };
  sort?: Array<{ field?: string; order?: 'asc' | 'desc' }>;
  statsField?: string;
  statsSize?: number;
};

function createFieldMap(fields: AlertFieldDefinition[]) {
  return new Map(fields.map((field) => [field.name, field] satisfies [string, AlertFieldDefinition]));
}

function buildSort(sort: SearchRequest['sort'], fieldMap: Map<string, AlertFieldDefinition>) {
  if (!sort?.length) {
    return [{ '@timestamp': { order: 'desc' } }];
  }

  return sort
    .filter((item) => item.field)
    .map((item) => {
      const field = fieldMap.get(item.field!);
      return {
        [(field?.sortField ?? item.field!)]: {
          order: item.order === 'asc' ? 'asc' : 'desc',
        },
      };
    });
}

function buildQuery(body: SearchRequest) {
  const filter: Array<Record<string, unknown>> = [
    { term: { 'event_type.keyword': 'alert' } },
  ];

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

function buildAggs(body: SearchRequest, fieldMap: Map<string, AlertFieldDefinition>) {
  if (!body.statsField) {
    return undefined;
  }

  const field = fieldMap.get(body.statsField);
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
    const fields = await getAlertFields();
    const fieldMap = createFieldMap(fields);
    const aggs = buildAggs(body, fieldMap);
    const payload = {
      track_total_hits: true,
      from: Math.max(0, body.page?.from ?? 0),
      size: Math.max(1, Math.min(200, body.page?.size ?? 25)),
      sort: buildSort(body.sort, fieldMap),
      query: buildQuery(body),
      ...(aggs ? { aggs } : {}),
    };

    const response = await esRequest('/selk-suricata-*/_search?ignore_unavailable=true', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message.startsWith('unknown stats field') || message.startsWith('field is not aggregatable') || message.startsWith('only lucene') ? 400 : 502;
    return NextResponse.json({ error: 'alerts_search_failed', message }, { status });
  }
}
