'use client';

import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';

import FieldListPanel from '@/components/FieldListPanel';
import FieldStatsPanel from '@/components/FieldStatsPanel';
import JsonPreview from '@/components/JsonPreview';
import LuceneFieldInput from '@/components/LuceneFieldInput';
import ResultTable from '@/components/ResultTable';
import SectionCard from '@/components/SectionCard';
import StatusPanel from '@/components/StatusPanel';
import type { AlertFieldDefinition } from '@/lib/alert-fields';

type ResizeTarget = {
  kind: 'sidebar';
  startX: number;
  startSidebarWidth: number;
} | null;

type AlertHit = {
  _id: string;
  _index: string;
  _source?: Record<string, unknown>;
};

type AggregationBucket = {
  key: string | number;
  key_as_string?: string;
  doc_count: number;
};

type EventTypeBucket = {
  key: string;
  doc_count: number;
};

type SearchResponse = {
  took?: number;
  hits?: {
    total?: {
      value?: number;
      relation?: string;
    };
    hits?: AlertHit[];
  };
  aggregations?: {
    field_missing?: { doc_count?: number };
    field_cardinality?: { value?: number };
    field_terms?: { buckets?: AggregationBucket[] };
    field_histogram?: { buckets?: AggregationBucket[] };
  };
};

type AiAnalysisResult = {
  summary: string;
  judgement: {
    risk_level: string;
    confidence: string;
    is_likely_true_positive: boolean;
    is_likely_successful_attack: boolean;
  };
  evidence: string[];
  analysis: {
    attack_intent: string;
    success_assessment: string;
    scope_hint: string;
    rule_consistency: string;
  };
  recommended_actions: string[];
};

type PersistedAiAnalysis = {
  result: AiAnalysisResult;
};

type AlertDetail = {
  id: string;
  index: string;
  title?: string;
  document?: Record<string, unknown>;
  aiAnalysis?: PersistedAiAnalysis | null;
  engine?: {
    attack_stage?: string;
    attack_success?: boolean;
    attack_success_confidence?: string;
  };
};

type AlertPreferences = {
  selectedFields?: string[];
  selectedStatsField?: string | null;
  sidebarWidth?: number;
  modalWidth?: number;
  columnWidths?: Record<string, number>;
  readAlertIds?: string[];
};

const DEFAULT_PAGE_SIZE = 20;
const TITLE_FIELD = 'alert.signature';
const DEFAULT_LOG_SELECTED_FIELDS = ['@timestamp', 'src_ip', 'src_port', 'dest_ip', 'dest_port', 'proto', 'app_proto'];

function toDateTimeLocalValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function buildTimeRange(option: string, customFrom: string, customTo: string) {
  const now = new Date();
  const end = now.toISOString();
  const start = new Date(now.getTime());

  if (option === '1h') start.setHours(start.getHours() - 1);
  else if (option === '6h') start.setHours(start.getHours() - 6);
  else if (option === '24h') start.setHours(start.getHours() - 24);
  else if (option === '7d') start.setDate(start.getDate() - 7);
  else if (option === '30d') start.setDate(start.getDate() - 30);
  else if (option === 'custom') {
    return {
      from: customFrom ? new Date(customFrom).toISOString() : start.toISOString(),
      to: customTo ? new Date(customTo).toISOString() : end,
    };
  }

  return { from: start.toISOString(), to: end };
}

function reorderList(items: string[], draggedItem: string, targetItem: string | null) {
  const filtered = items.filter((item) => item !== draggedItem);
  if (!targetItem) return [...filtered, draggedItem];
  const targetIndex = filtered.indexOf(targetItem);
  if (targetIndex < 0) return [...filtered, draggedItem];
  filtered.splice(targetIndex, 0, draggedItem);
  return filtered;
}

function escapeLuceneValue(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildLuceneClause(field: AlertFieldDefinition | undefined, value: string, mode: 'include' | 'exclude') {
  const queryField = field?.queryField ?? field?.name ?? '';
  const trimmed = value.trim();
  if (!queryField || !trimmed) return '';

  const isBoolean = field?.type === 'boolean' || /^(true|false)$/i.test(trimmed);
  const isNumber = ['byte', 'short', 'integer', 'long', 'float', 'double', 'half_float', 'scaled_float'].includes(field?.type ?? '') || /^-?\d+(\.\d+)?$/.test(trimmed);
  const rendered = isBoolean
    ? `${queryField}:${trimmed.toLowerCase()}`
    : isNumber
      ? `${queryField}:${trimmed}`
      : `${queryField}:"${escapeLuceneValue(trimmed)}"`;

  return mode === 'exclude' ? `NOT (${rendered})` : rendered;
}

function appendClause(current: string, clause: string) {
  const trimmedCurrent = current.trim();
  if (!trimmedCurrent) return clause;
  return `${trimmedCurrent} AND ${clause}`;
}

function formatDetailValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function flattenDocumentFields(document: Record<string, unknown> | undefined) {
  const rows: Array<{ field: string; value: unknown }> = [];
  if (!document) return rows;

  function visit(value: unknown, path: string) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length === 0) {
        rows.push({ field: path, value });
        return;
      }
      entries.forEach(([key, child]) => visit(child, path ? `${path}.${key}` : key));
      return;
    }
    rows.push({ field: path, value });
  }

  visit(document, '');
  return rows;
}

function LogFieldTable({ document }: { document?: Record<string, unknown> }) {
  const rows = flattenDocumentFields(document);
  if (rows.length === 0) return <div className="empty-hint">当前日志没有可展示字段。</div>;

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr><th>字段</th><th>值</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.field}>
              <td><code>{row.field}</code></td>
              <td><span className="table-cell-text">{formatDetailValue(row.value)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AiResultPanel({ result }: { result: AiAnalysisResult }) {
  return (
    <div className="section-card">
      <SectionCard title="结论">
        <div className="section-card-description">{result.summary || '暂无结论。'}</div>
      </SectionCard>
      <SectionCard title="风险判断">
        <div className="probe-metric-grid">
          <div className="probe-metric-item"><span className="probe-metric-label">风险等级</span><strong className="probe-metric-value">{result.judgement.risk_level || '暂无'}</strong></div>
          <div className="probe-metric-item"><span className="probe-metric-label">置信度</span><strong className="probe-metric-value">{result.judgement.confidence || '暂无'}</strong></div>
          <div className="probe-metric-item"><span className="probe-metric-label">是否疑似真实攻击</span><strong className="probe-metric-value">{result.judgement.is_likely_true_positive ? '是' : '否'}</strong></div>
          <div className="probe-metric-item"><span className="probe-metric-label">是否疑似攻击成功</span><strong className="probe-metric-value">{result.judgement.is_likely_successful_attack ? '是' : '否'}</strong></div>
        </div>
      </SectionCard>
      <SectionCard title="关键证据">
        {result.evidence.length ? <ul className="list">{result.evidence.map((item) => <li key={item}>{item}</li>)}</ul> : <div className="empty-hint">暂无证据摘要。</div>}
      </SectionCard>
      <SectionCard title="分析说明">
        <div className="probe-metric-grid">
          <div className="probe-metric-item"><span className="probe-metric-label">攻击意图</span><strong className="probe-metric-value">{result.analysis.attack_intent || '暂无'}</strong></div>
          <div className="probe-metric-item"><span className="probe-metric-label">成功性判断</span><strong className="probe-metric-value">{result.analysis.success_assessment || '暂无'}</strong></div>
          <div className="probe-metric-item"><span className="probe-metric-label">影响范围提示</span><strong className="probe-metric-value">{result.analysis.scope_hint || '暂无'}</strong></div>
          <div className="probe-metric-item"><span className="probe-metric-label">规则一致性</span><strong className="probe-metric-value">{result.analysis.rule_consistency || '暂无'}</strong></div>
        </div>
      </SectionCard>
      <SectionCard title="建议动作">
        {result.recommended_actions.length ? <ul className="list">{result.recommended_actions.map((item) => <li key={item}>{item}</li>)}</ul> : <div className="empty-hint">暂无建议动作。</div>}
      </SectionCard>
    </div>
  );
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const message = typeof payload === 'object' && payload && 'message' in payload ? String((payload as { message: unknown }).message) : response.statusText;
    throw new Error(message);
  }
  return payload as T;
}

export default function LogsPage() {
  const [fields, setFields] = useState<AlertFieldDefinition[]>([]);
  const [fieldsError, setFieldsError] = useState('');
  const [loadingFields, setLoadingFields] = useState(true);
  const [queryInput, setQueryInput] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [selectedStatsField, setSelectedStatsField] = useState<string | null>(null);
  const [sortField, setSortField] = useState('@timestamp');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [statsModalOpen, setStatsModalOpen] = useState(false);
  const [searchHelpOpen, setSearchHelpOpen] = useState(false);
  const [timeRange, setTimeRange] = useState('24h');
  const [customFrom, setCustomFrom] = useState(() => toDateTimeLocalValue(new Date(Date.now() - 24 * 60 * 60 * 1000)));
  const [customTo, setCustomTo] = useState(() => toDateTimeLocalValue(new Date()));
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [resultsError, setResultsError] = useState('');
  const [loadingResults, setLoadingResults] = useState(false);
  const [eventTypes, setEventTypes] = useState<EventTypeBucket[]>([]);
  const [selectedEventTypes, setSelectedEventTypes] = useState<string[]>([]);
  const [eventTypesError, setEventTypesError] = useState('');
  const [loadingEventTypes, setLoadingEventTypes] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(150);
  const [modalWidth, setModalWidth] = useState(70);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({ [TITLE_FIELD]: 260 });
  const [resizeTarget, setResizeTarget] = useState<ResizeTarget>(null);
  const [detailTab, setDetailTab] = useState<'fields' | 'ai' | 'json'>('fields');
  const [detail, setDetail] = useState<AlertDetail | null>(null);
  const [detailError, setDetailError] = useState('');
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [aiResult, setAiResult] = useState<AiAnalysisResult | null>(null);
  const [aiError, setAiError] = useState('');
  const [loadingAi, setLoadingAi] = useState(false);
  const [bulkAiLoading, setBulkAiLoading] = useState(false);
  const [bulkAiError, setBulkAiError] = useState('');
  const [bulkAiSummary, setBulkAiSummary] = useState<{ total: number; succeeded: number; failed: number; skipped: number } | null>(null);
  const [readAlertIds, setReadAlertIds] = useState<string[]>([]);
  const [preferencesHydrated, setPreferencesHydrated] = useState(false);

  const fieldLabels = useMemo(() => Object.fromEntries(fields.map((field) => [field.name, field.label])), [fields]);
  const fieldMap = useMemo(() => Object.fromEntries(fields.map((field) => [field.name, field])), [fields]);
  const fieldKeyMap = useMemo(() => Object.fromEntries(fields.map((field) => [field.name, field.key])), [fields]);
  const queryFields = useMemo(() => Object.fromEntries(fields.map((field) => [field.name, field.queryField])), [fields]);
  const hits = results?.hits?.hits ?? [];
  const total = results?.hits?.total?.value ?? 0;
  const relation = results?.hits?.total?.relation;
  const canGoPrevious = page > 0;
  const canGoNext = relation === 'gte' ? hits.length === pageSize : total > (page + 1) * pageSize;
  const currentAlertIndex = selectedAlertId ? hits.findIndex((hit) => hit._id === selectedAlertId) : -1;
  const canOpenPreviousAlert = currentAlertIndex > 0;
  const canOpenNextAlert = currentAlertIndex >= 0 && currentAlertIndex < hits.length - 1;

  const searchBody = useMemo(() => ({
    query: appliedQuery,
    querySyntax: 'lucene',
    timeRange: buildTimeRange(timeRange, customFrom, customTo),
    eventTypes: selectedEventTypes,
    sort: [{ field: sortField, order: sortOrder }],
    page: { from: page * pageSize, size: pageSize },
    statsField: selectedStatsField ?? undefined,
    statsSize: 8,
  }), [appliedQuery, customFrom, customTo, page, pageSize, selectedEventTypes, selectedStatsField, sortField, sortOrder, timeRange, refreshNonce]);

  useEffect(() => {
    async function loadFields() {
      try {
        setLoadingFields(true);
        setFieldsError('');
        const response = await fetchJson<AlertFieldDefinition[]>('/api/logs/fields');
        const preferencesResponse = await fetchJson<{ preferences: AlertPreferences }>('/api/logs/preferences');
        const validFieldNames = new Set(response.map((field) => field.name));
        const defaults = DEFAULT_LOG_SELECTED_FIELDS.filter((fieldName) => validFieldNames.has(fieldName));
        const persistedFields = (preferencesResponse.preferences?.selectedFields ?? []).filter((fieldName) => fieldName !== TITLE_FIELD && validFieldNames.has(fieldName));
        const nextStatsField = preferencesResponse.preferences?.selectedStatsField;

        setFields(response);
        setSelectedFields(persistedFields.length ? persistedFields : defaults);
        setSelectedStatsField(nextStatsField && validFieldNames.has(nextStatsField) ? nextStatsField : TITLE_FIELD);
        setSidebarWidth(preferencesResponse.preferences?.sidebarWidth ?? 150);
        setModalWidth(preferencesResponse.preferences?.modalWidth ?? 70);
        setColumnWidths({ [TITLE_FIELD]: 260, ...(preferencesResponse.preferences?.columnWidths ?? {}) });
        setReadAlertIds(preferencesResponse.preferences?.readAlertIds ?? []);
        setPreferencesHydrated(true);
      } catch (error) {
        setFieldsError(error instanceof Error ? error.message : '字段目录加载失败');
      } finally {
        setLoadingFields(false);
      }
    }
    void loadFields();
  }, []);

  useEffect(() => {
    if (!fields.length) return;
    async function loadEventTypes() {
      try {
        setLoadingEventTypes(true);
        setEventTypesError('');
        const response = await fetchJson<{ eventTypes: EventTypeBucket[] }>('/api/logs/event-types', {
          method: 'POST',
          body: JSON.stringify({
            query: appliedQuery,
            querySyntax: 'lucene',
            timeRange: buildTimeRange(timeRange, customFrom, customTo),
          }),
        });
        const nextEventTypes = response.eventTypes ?? [];
        setEventTypes(nextEventTypes);
        setSelectedEventTypes((current) => current.filter((item) => nextEventTypes.some((bucket) => bucket.key === item)));
      } catch (error) {
        setEventTypesError(error instanceof Error ? error.message : '日志类型加载失败');
      } finally {
        setLoadingEventTypes(false);
      }
    }
    void loadEventTypes();
  }, [appliedQuery, customFrom, customTo, fields.length, refreshNonce, timeRange]);

  useEffect(() => {
    if (!fields.length) return;
    async function loadResults() {
      try {
        setLoadingResults(true);
        setResultsError('');
        const response = await fetchJson<SearchResponse>('/api/logs/search', {
          method: 'POST',
          body: JSON.stringify(searchBody),
        });
        setResults(response);
      } catch (error) {
        setResultsError(error instanceof Error ? error.message : '日志搜索失败');
      } finally {
        setLoadingResults(false);
      }
    }
    void loadResults();
  }, [fields.length, searchBody]);

  useEffect(() => {
    if (!selectedAlertId) return;
    async function loadDetail() {
      try {
        setLoadingDetail(true);
        setDetailError('');
        const response = await fetchJson<AlertDetail>(`/api/logs/${selectedAlertId}/detail`);
        setDetail(response);
        setAiResult(response.aiAnalysis?.result ?? null);
      } catch (error) {
        setDetailError(error instanceof Error ? error.message : '详情加载失败');
      } finally {
        setLoadingDetail(false);
      }
    }
    void loadDetail();
  }, [selectedAlertId]);

  useEffect(() => {
    if (!preferencesHydrated) return undefined;
    const timer = window.setTimeout(() => {
      void fetchJson<{ preferences: AlertPreferences }>('/api/logs/preferences', {
        method: 'PUT',
        body: JSON.stringify({
          selectedFields,
          selectedStatsField,
          sidebarWidth,
          modalWidth,
          columnWidths,
          readAlertIds,
        }),
      }).catch(() => undefined);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [columnWidths, modalWidth, preferencesHydrated, readAlertIds, selectedFields, selectedStatsField, sidebarWidth]);

  useEffect(() => {
    if (!resizeTarget) return undefined;
    const activeResize = resizeTarget;

    function onMouseMove(event: MouseEvent) {
      const nextWidth = Math.max(120, Math.min(420, activeResize.startSidebarWidth + (event.clientX - activeResize.startX)));
      setSidebarWidth(nextWidth);
    }

    function onMouseUp() {
      setResizeTarget(null);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [resizeTarget]);

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(0);
    setAppliedQuery(queryInput.trim());
  }

  function addField(fieldName: string) {
    if (fieldName !== TITLE_FIELD) setSelectedFields((current) => (current.includes(fieldName) ? current : [...current, fieldName]));
  }

  function removeField(fieldName: string) {
    setSelectedFields((current) => current.filter((item) => item !== fieldName));
  }

  function reorderField(draggedField: string, targetField: string | null) {
    if (draggedField === TITLE_FIELD) return;
    setSelectedFields((current) => reorderList(current, draggedField, targetField));
  }

  function openStats(fieldName: string) {
    setSelectedStatsField(fieldName);
    setStatsModalOpen(true);
    setPage(0);
  }

  function changeSort(fieldName: string) {
    setPage(0);
    if (sortField === fieldName) {
      setSortOrder((current) => current === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSortField(fieldName);
    setSortOrder('desc');
  }

  function toggleEventType(eventType: string) {
    setPage(0);
    setSelectedEventTypes((current) => current.includes(eventType) ? current.filter((item) => item !== eventType) : [...current, eventType]);
  }

  function applyQuickFilter(fieldName: string, value: string, mode: 'include' | 'exclude') {
    const clause = buildLuceneClause(fieldMap[fieldName], value, mode);
    if (!clause) return;
    const nextQuery = appendClause(queryInput || appliedQuery, clause);
    setQueryInput(nextQuery);
    setAppliedQuery(nextQuery);
    setPage(0);
  }

  function openAlert(alertId: string) {
    setSelectedAlertId(alertId);
    setDetailTab('fields');
    setDetail(null);
    setDetailError('');
    setAiError('');
  }

  function openRelativeAlert(offset: -1 | 1) {
    if (currentAlertIndex < 0) return;
    const target = hits[currentAlertIndex + offset];
    if (target) openAlert(target._id);
  }

  function closeDetailModal() {
    setSelectedAlertId(null);
    setDetail(null);
    setAiResult(null);
    setAiError('');
  }

  function toggleRead(alertId: string) {
    setReadAlertIds((current) => current.includes(alertId) ? current.filter((item) => item !== alertId) : [...current, alertId]);
  }

  async function runAiAnalysis() {
    if (!selectedAlertId) return;
    try {
      setLoadingAi(true);
      setAiError('');
      setDetailTab('ai');
      const response = await fetchJson<{ result: { result: AiAnalysisResult } | null }>('/api/ai/analyze-alert', {
        method: 'POST',
        body: JSON.stringify({ alertId: selectedAlertId, indexPattern: 'selk-event-*' }),
      });
      setAiResult(response.result?.result ?? null);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'AI 研判失败');
    } finally {
      setLoadingAi(false);
    }
  }

  async function runBulkAiAnalysis() {
    const alertIds = hits.map((hit) => hit._id);
    if (alertIds.length === 0) return;
    try {
      setBulkAiLoading(true);
      setBulkAiError('');
      setBulkAiSummary(null);
      const response = await fetchJson<{ total: number; succeeded: number; failed: number; skipped: number }>('/api/ai/analyze-alert', {
        method: 'POST',
        body: JSON.stringify({ alertIds, indexPattern: 'selk-event-*' }),
      });
      setBulkAiSummary(response);
    } catch (error) {
      setBulkAiError(error instanceof Error ? error.message : '批量 AI 研判失败');
    } finally {
      setBulkAiLoading(false);
    }
  }

  if (loadingFields) return <StatusPanel title="日志中心加载中" description="正在读取字段目录与页面配置。" />;
  if (fieldsError) return <StatusPanel title="字段目录加载失败" description={fieldsError} tone="error" />;

  return (
    <section className="page alerts-page">
      <header className="page-header">
        <h1 className="page-title">日志中心</h1>
        <p className="page-description">面向 selk-event-* 的原始日志检索、字段统计与 AI 研判。</p>
      </header>

      <form className="card toolbar alerts-toolbar" onSubmit={handleSearch}>
        <div className="toolbar-group alerts-query-group">
          <LuceneFieldInput
            fields={fields}
            onChange={setQueryInput}
            placeholder="输入 Lucene 查询，例如 event_type.keyword:&quot;alert&quot; AND src_ip.keyword:&quot;192.168.52.1&quot;"
            value={queryInput}
          />
          <select className="input alerts-time-select" value={timeRange} onChange={(event) => { setPage(0); setTimeRange(event.target.value); }}>
            <option value="1h">最近 1 小时</option>
            <option value="6h">最近 6 小时</option>
            <option value="24h">最近 24 小时</option>
            <option value="7d">最近 7 天</option>
            <option value="30d">最近 30 天</option>
            <option value="custom">自由选择</option>
          </select>
          {timeRange === 'custom' ? (
            <>
              <input className="input alerts-time-input" type="datetime-local" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} />
              <input className="input alerts-time-input" type="datetime-local" value={customTo} onChange={(event) => setCustomTo(event.target.value)} />
            </>
          ) : null}
        </div>

        <div className="log-type-filter">
          <div className="log-type-filter-header">
            <span className="field-section-title">日志类型</span>
            <span className="muted">{loadingEventTypes ? '加载中...' : selectedEventTypes.length ? `已选 ${selectedEventTypes.length} 项` : '全部类型'}</span>
            {selectedEventTypes.length ? <button className="link-button" type="button" onClick={() => { setPage(0); setSelectedEventTypes([]); }}>清空</button> : null}
          </div>
          {eventTypesError ? <div className="status-inline status-inline-error">{eventTypesError}</div> : null}
          <div className="log-type-options">
            {eventTypes.map((item) => (
              <label className={`log-type-option ${selectedEventTypes.includes(item.key) ? 'log-type-option-active' : ''}`} key={item.key}>
                <input type="checkbox" checked={selectedEventTypes.includes(item.key)} onChange={() => toggleEventType(item.key)} />
                <span>{item.key}</span>
                <span className="muted">{item.doc_count.toLocaleString('zh-CN')}</span>
              </label>
            ))}
            {!loadingEventTypes && !eventTypesError && eventTypes.length === 0 ? <span className="muted">当前条件下没有可选日志类型</span> : null}
          </div>
        </div>

        <div className="toolbar-group">
          <button className="button button-primary" type="submit">搜索</button>
          <button className="button" type="button" onClick={() => setRefreshNonce((current) => current + 1)}>刷新</button>
          <button className="button" type="button" onClick={() => setSearchHelpOpen((current) => !current)}>{searchHelpOpen ? '收起说明' : '搜索说明'}</button>
        </div>

        {searchHelpOpen ? (
          <div className="search-help-panel">
            <div className="search-help-grid search-help-grid-inline">
              <div className="search-help-example"><span>普通搜索</span><pre className="code code-block">event_type.keyword:"alert"</pre></div>
              <div className="search-help-example"><span>模糊搜索</span><pre className="code code-block">url.keyword:"/admin*"</pre></div>
              <div className="search-help-example"><span>逻辑运算符</span><pre className="code code-block">src_ip.keyword:"192.168.52.1" AND dest_port:443</pre></div>
              <div className="search-help-example"><span>排除条件</span><pre className="code code-block">NOT proto.keyword:"TCP"</pre></div>
            </div>
          </div>
        ) : null}
      </form>

      <div className="alerts-workspace" style={{ gridTemplateColumns: `${sidebarWidth}px 10px minmax(0, 1fr)` }}>
        <aside className="alerts-sidebar">
          <SectionCard title="字段面板" description="点击字段查看统计，拖动字段调整结果列顺序。">
            <FieldListPanel
              fields={fields}
              selectedFields={selectedFields}
              selectedStatsField={selectedStatsField}
              onAddField={addField}
              onRemoveField={removeField}
              onReorderSelectedField={reorderField}
              onSelectStatsField={openStats}
            />
          </SectionCard>
        </aside>

        <div
          className="pane-resizer"
          onMouseDown={(event) => {
            event.preventDefault();
            setResizeTarget({ kind: 'sidebar', startX: event.clientX, startSidebarWidth: sidebarWidth });
          }}
        />

        <main className="alerts-main">
          <SectionCard
            title="搜索结果"
            description={`当前命中 ${relation === 'gte' ? `${total.toLocaleString('zh-CN')}+` : total.toLocaleString('zh-CN')} 条结果。`}
            actions={
              <div className="toolbar-group">
                <label className="muted inline-label">
                  每页
                  <select className="input page-size-select" value={pageSize} onChange={(event) => { setPage(0); setPageSize(Number(event.target.value)); }}>
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </label>
                <span className="muted">第 {page + 1} 页</span>
                <button className="button" type="button" disabled={!canGoPrevious} onClick={() => setPage((current) => Math.max(0, current - 1))}>上一页</button>
                <button className="button" type="button" disabled={!canGoNext} onClick={() => setPage((current) => current + 1)}>下一页</button>
                <button className="button button-primary" type="button" disabled={hits.length === 0 || loadingResults || bulkAiLoading} onClick={() => void runBulkAiAnalysis()}>{bulkAiLoading ? '研判中...' : '当前页AI研判'}</button>
              </div>
            }
          >
            {bulkAiError ? <div className="status-inline status-inline-error">{bulkAiError}</div> : null}
            {bulkAiSummary ? <div className="status-inline status-inline-success">当前页 AI 研判完成：共 {bulkAiSummary.total} 条，成功 {bulkAiSummary.succeeded} 条，失败 {bulkAiSummary.failed} 条，跳过 {bulkAiSummary.skipped} 条。</div> : null}
            {loadingResults ? (
              <StatusPanel title="搜索中" description="正在从 Elasticsearch 检索日志结果。" />
            ) : resultsError ? (
              <StatusPanel title="搜索失败" description={resultsError} tone="error" />
            ) : hits.length === 0 ? (
              <div className="empty-hint">当前查询条件下没有日志结果。</div>
            ) : (
              <ResultTable
                hits={hits}
                titleField={TITLE_FIELD}
                selectedFields={selectedFields}
                fieldLabels={fieldLabels}
                fieldKeys={fieldKeyMap}
                queryFields={queryFields}
                sortField={sortField}
                sortOrder={sortOrder}
                readAlertIds={readAlertIds}
                columnWidths={columnWidths}
                onSortChange={changeSort}
                onSelectAlert={(hit) => openAlert(hit._id)}
                onReorderColumns={reorderField}
                onColumnWidthChange={(fieldName, width) => setColumnWidths((current) => ({ ...current, [fieldName]: width }))}
                onQuickFilter={applyQuickFilter}
              />
            )}
          </SectionCard>
        </main>
      </div>

      {selectedAlertId ? (
        <div className="modal-backdrop" onClick={closeDetailModal} role="presentation">
          <div className="modal-window alert-detail-modal" style={{ width: `${modalWidth}vw`, maxWidth: `${modalWidth}vw` }} onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header modal-header-compact">
              <span className="modal-header-segment modal-header-segment-title" title={detail?.title ?? '日志详情'}>{detail?.title ?? '日志详情'}</span>
              {(detail?.engine?.attack_stage || typeof detail?.engine?.attack_success === 'boolean' || detail?.engine?.attack_success_confidence) ? (
                <div className="modal-header-segment">
                  {detail?.engine?.attack_stage ? <span className={`status-pill ${detail.engine.attack_stage === 'confirmed_success' ? 'status-red' : detail.engine.attack_stage === 'probable_success' ? 'status-yellow' : 'status-gray'}`}>{detail.engine.attack_stage}</span> : null}
                  {typeof detail?.engine?.attack_success === 'boolean' ? <span className={`status-pill ${detail.engine.attack_success ? 'status-red' : 'status-gray'}`}>{detail.engine.attack_success ? '攻击成功' : '攻击未成功'}</span> : null}
                  {detail?.engine?.attack_success_confidence ? <span className={`status-pill ${detail.engine.attack_success_confidence === 'high' ? 'status-red' : detail.engine.attack_success_confidence === 'medium' ? 'status-yellow' : 'status-gray'}`}>{detail.engine.attack_success_confidence}</span> : null}
                </div>
              ) : null}
              <div className="modal-header-segment modal-header-segment-push">
                <button className="button" type="button" disabled={!canOpenPreviousAlert} onClick={() => openRelativeAlert(-1)}>上一条</button>
                <button className="button" type="button" disabled={!canOpenNextAlert} onClick={() => openRelativeAlert(1)}>下一条</button>
              </div>
              <div className="modal-header-segment">
                <button className="button" type="button" onClick={() => toggleRead(selectedAlertId)}>{readAlertIds.includes(selectedAlertId) ? '标记未读' : '标记已读'}</button>
                <button className="button button-primary" type="button" disabled={loadingAi} onClick={() => void runAiAnalysis()}>{loadingAi ? 'AI 研判中...' : 'AI研判'}</button>
              </div>
              <div className="modal-header-segment">
                <button className="button" type="button" onClick={closeDetailModal}>关闭</button>
              </div>
            </div>

            {loadingDetail ? (
              <StatusPanel title="详情加载中" description="正在读取日志详情。" />
            ) : detailError ? (
              <StatusPanel title="详情加载失败" description={detailError} tone="error" />
            ) : (
              <div className="modal-tabbed-content">
                <div className="modal-tabs" role="tablist" aria-label="日志详情内容切换">
                  <button className={`modal-tab ${detailTab === 'fields' ? 'modal-tab-active' : ''}`} type="button" onClick={() => setDetailTab('fields')}>字段面板</button>
                  <button className={`modal-tab ${detailTab === 'ai' ? 'modal-tab-active' : ''}`} type="button" onClick={() => setDetailTab('ai')}>AI 研判</button>
                  <button className={`modal-tab ${detailTab === 'json' ? 'modal-tab-active' : ''}`} type="button" onClick={() => setDetailTab('json')}>原始日志</button>
                </div>
                {detailTab === 'fields' ? (
                  <SectionCard title="字段面板" description="以 ES 原始字段路径和值展示当前日志。">
                    <LogFieldTable document={detail?.document} />
                  </SectionCard>
                ) : null}
                {detailTab === 'json' ? (
                  <SectionCard title="原始日志（JSON）" description="保留完整 _source，便于继续排障与字段确认。">
                    <JsonPreview value={detail?.document} emptyText="当前日志没有原始日志内容。" />
                  </SectionCard>
                ) : null}
                {detailTab === 'ai' ? (
                  <SectionCard title="AI 研判结果" description="基于日志上下文生成。">
                    {loadingAi ? (
                      <StatusPanel title="AI 研判中" description="正在调用 AI 接口生成研判结果。" />
                    ) : aiError ? (
                      <StatusPanel title="AI 研判失败" description={aiError} tone="error" />
                    ) : aiResult ? (
                      <AiResultPanel result={aiResult} />
                    ) : (
                      <div className="empty-hint">点击上方“AI研判”按钮开始分析当前日志。</div>
                    )}
                  </SectionCard>
                ) : null}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {statsModalOpen ? (
        <div className="modal-backdrop" onClick={() => setStatsModalOpen(false)} role="presentation">
          <div className="stats-modal-window" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <div>
                <div className="modal-title">字段统计</div>
                <div className="muted">点击左侧其他字段可切换统计对象</div>
              </div>
              <button className="button" type="button" onClick={() => setStatsModalOpen(false)}>关闭</button>
            </div>
            <FieldStatsPanel
              field={selectedStatsField ? fields.find((field) => field.name === selectedStatsField) ?? null : null}
              aggregations={results?.aggregations ?? null}
              loading={loadingResults}
              errorMessage={resultsError}
              onQuickFilter={applyQuickFilter}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
