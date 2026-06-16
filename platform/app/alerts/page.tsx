'use client';

import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';

type ResizeTarget = {
  kind: 'sidebar' | 'modal';
  startX: number;
  startY: number;
  startSidebarWidth: number;
  startModalWidth: number;
  startModalHeight: number;
} | null;
import FieldListPanel from '@/components/FieldListPanel';
import FieldStatsPanel from '@/components/FieldStatsPanel';
import HttpPreview from '@/components/HttpPreview';
import JsonPreview from '@/components/JsonPreview';
import LuceneFieldInput from '@/components/LuceneFieldInput';
import ResultTable from '@/components/ResultTable';
import SectionCard from '@/components/SectionCard';
import StatusPanel from '@/components/StatusPanel';
import type { AlertFieldDefinition } from '@/lib/alert-fields';
import { ALERT_TITLE_FIELD_KEY } from '@/lib/alert-field-mapping-schema';

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

type AlertDetail = {
  id: string;
  index: string;
  title?: string;
  document?: Record<string, unknown>;
  payloadPrintable?: string;
  engine?: {
    attack_stage?: string;
    attack_success?: boolean;
    attack_success_confidence?: string;
    attack_success_reason?: string[];
  };
  http?: {
    request?: { raw?: string; body?: string; highlights?: Array<{ start: number; end: number }> };
    response?: { raw?: string; body?: string; highlights?: Array<{ start: number; end: number }> };
    payload?: string;
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

type AlertPreferences = {
  selectedFields: string[];
  selectedStatsField: string;
  sidebarWidth: number;
  modalWidth: number;
  modalHeight: number;
  columnWidths: Record<string, number>;
  readAlertIds: string[];
};

const DEFAULT_PAGE_SIZE = 20;

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
    const from = customFrom ? new Date(customFrom).toISOString() : start.toISOString();
    const to = customTo ? new Date(customTo).toISOString() : end;
    return { from, to };
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
  if (!queryField) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const isBoolean = field?.type === 'boolean' || /^(true|false)$/i.test(trimmed);
  const isNumber = field?.type === 'integer' || /^\d+$/.test(trimmed);
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

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const message = typeof payload === 'object' && payload && 'message' in payload ? String((payload as { message?: unknown }).message) : String(payload || `Request failed with ${response.status}`);
    throw new Error(message);
  }
  return payload as T;
}

export default function AlertsPage() {
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
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(150);
  const [modalWidth, setModalWidth] = useState(70);
  const [modalHeight, setModalHeight] = useState(70);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({
    'alert.signature': 260,
  });
  const [resizeTarget, setResizeTarget] = useState<ResizeTarget>(null);
  const [detailTab, setDetailTab] = useState<'http' | 'json' | 'ai'>('http');
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

  useEffect(() => {
    async function loadFields() {
      try {
        setLoadingFields(true);
        setFieldsError('');
        const response = await fetchJson<AlertFieldDefinition[]>('/api/alerts/fields');
        const preferencesResponse = await fetchJson<{ preferences: AlertPreferences }>('/api/alerts/preferences');
        const titleFieldFromResponse = response.find((field) => field.key === ALERT_TITLE_FIELD_KEY)?.name ?? 'alert.signature';
        const defaults = response.filter((field) => field.defaultSelected && field.name !== titleFieldFromResponse).map((field) => field.name);
        setFields(response);
        setSelectedFields(preferencesResponse.preferences?.selectedFields?.length ? preferencesResponse.preferences.selectedFields : defaults);
        setSelectedStatsField(preferencesResponse.preferences?.selectedStatsField ?? titleFieldFromResponse);
        setSidebarWidth(preferencesResponse.preferences?.sidebarWidth ?? 150);
        setModalWidth(preferencesResponse.preferences?.modalWidth ?? 70);
        setModalHeight(preferencesResponse.preferences?.modalHeight ?? 70);
        setColumnWidths(preferencesResponse.preferences?.columnWidths ?? { [titleFieldFromResponse]: 260 });
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

  const searchBody = useMemo(
    () => ({
      query: appliedQuery,
      querySyntax: 'lucene',
      timeRange: buildTimeRange(timeRange, customFrom, customTo),
      sort: [{ field: sortField, order: sortOrder }],
      page: { from: page * pageSize, size: pageSize },
      statsField: selectedStatsField ?? undefined,
      statsSize: 8,
    }),
    [appliedQuery, page, pageSize, selectedStatsField, sortField, sortOrder, timeRange, customFrom, customTo, refreshNonce],
  );

  useEffect(() => {
    if (!fields.length) return;
    async function loadResults() {
      try {
        setLoadingResults(true);
        setResultsError('');
        const response = await fetchJson<SearchResponse>('/api/alerts/search', {
          method: 'POST',
          body: JSON.stringify(searchBody),
        });
        setResults(response);
      } catch (error) {
        setResultsError(error instanceof Error ? error.message : '告警搜索失败');
      } finally {
        setLoadingResults(false);
      }
    }
    void loadResults();
  }, [fields.length, searchBody, refreshNonce]);

  useEffect(() => {
    if (!selectedAlertId) return;
    async function loadDetail() {
      try {
        setLoadingDetail(true);
        setDetailError('');
        const response = await fetchJson<AlertDetail>(`/api/alerts/${selectedAlertId}/detail`);
        setDetail(response);
      } catch (error) {
        setDetailError(error instanceof Error ? error.message : '详情加载失败');
      } finally {
        setLoadingDetail(false);
      }
    }
    void loadDetail();
  }, [selectedAlertId]);

  useEffect(() => {
    if (!selectedAlertId) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedAlertId(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedAlertId]);

  useEffect(() => {
    if (!preferencesHydrated) return undefined;

    const timer = window.setTimeout(() => {
      void fetchJson<{ preferences: AlertPreferences }>('/api/alerts/preferences', {
        method: 'PUT',
        body: JSON.stringify({
          selectedFields,
          selectedStatsField,
          sidebarWidth,
          modalWidth,
          modalHeight,
          columnWidths,
          readAlertIds,
        }),
      }).catch(() => undefined);
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [preferencesHydrated, selectedFields, selectedStatsField, sidebarWidth, modalWidth, modalHeight, columnWidths, readAlertIds]);

  useEffect(() => {
    if (!resizeTarget) return undefined;
    const activeResize = resizeTarget;

    function onMouseMove(event: MouseEvent) {
      if (activeResize.kind === 'sidebar') {
        const nextWidth = Math.max(120, Math.min(420, activeResize.startSidebarWidth + (event.clientX - activeResize.startX)));
        setSidebarWidth(nextWidth);
        return;
      }

      const nextWidth = Math.max(45, Math.min(95, activeResize.startModalWidth + ((event.clientX - activeResize.startX) / window.innerWidth) * 100));
      const nextHeight = Math.max(45, Math.min(95, activeResize.startModalHeight + ((event.clientY - activeResize.startY) / window.innerHeight) * 100));
      setModalWidth(nextWidth);
      setModalHeight(nextHeight);
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

  const fieldLabels = useMemo(() => {
    const map: Record<string, string> = {};
    fields.forEach((field) => { map[field.name] = field.label; });
    return map;
  }, [fields]);

  const fieldMap = useMemo(() => {
    const map: Record<string, AlertFieldDefinition> = {};
    fields.forEach((field) => { map[field.name] = field; });
    return map;
  }, [fields]);

  const fieldKeyMap = useMemo(() => {
    const map: Record<string, string> = {};
    fields.forEach((field) => { map[field.name] = field.key; });
    return map;
  }, [fields]);

  const fieldByKey = useMemo(() => {
    const map: Partial<Record<string, AlertFieldDefinition>> = {};
    fields.forEach((field) => { map[field.key] = field; });
    return map;
  }, [fields]);

  const titleField = fieldByKey[ALERT_TITLE_FIELD_KEY]?.name ?? 'alert.signature';

  const hits = results?.hits?.hits ?? [];
  const total = results?.hits?.total?.value ?? 0;
  const relation = results?.hits?.total?.relation;
  const canGoPrevious = page > 0;
  const canGoNext = relation === 'gte' ? hits.length === pageSize : total > (page + 1) * pageSize;
  const currentAlertIndex = selectedAlertId ? hits.findIndex((hit) => hit._id === selectedAlertId) : -1;
  const canOpenPreviousAlert = currentAlertIndex > 0;
  const canOpenNextAlert = currentAlertIndex >= 0 && currentAlertIndex < hits.length - 1;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(0);
    setAppliedQuery(queryInput.trim());
  }

  function openStats(fieldName: string) {
    setSelectedStatsField(fieldName);
    setStatsModalOpen(true);
    setPage(0);
  }

  function addField(fieldName: string) {
    if (fieldName === 'alert.signature') return;
    setSelectedFields((current) => (current.includes(fieldName) ? current : [...current, fieldName]));
  }

  function removeField(fieldName: string) {
    setSelectedFields((current) => current.filter((item) => item !== fieldName));
  }

  function reorderField(draggedField: string, targetField: string | null) {
    if (draggedField === 'alert.signature') return;
    setSelectedFields((current) => reorderList(current, draggedField, targetField));
  }

  function changeSort(fieldName: string) {
    setPage(0);
    if (sortField === fieldName) {
      setSortOrder((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortField(fieldName);
    setSortOrder('desc');
  }

  function markRead(alertId: string) {
    setReadAlertIds((current) => (current.includes(alertId) ? current : [...current, alertId]));
  }

  function toggleRead(alertId: string) {
    setReadAlertIds((current) =>
      current.includes(alertId) ? current.filter((item) => item !== alertId) : [...current, alertId],
    );
  }

  function openAlert(alertId: string) {
    markRead(alertId);
    setDetailTab('http');
    setAiResult(null);
    setAiError('');
    setSelectedAlertId(alertId);
  }

  async function runAiAnalysis() {
    if (!selectedAlertId) return;
    try {
      setLoadingAi(true);
      setAiError('');
      setDetailTab('ai');
      const response = await fetchJson<{ result: { result: AiAnalysisResult } | null }>('/api/ai/analyze-alert', {
        method: 'POST',
        body: JSON.stringify({ alertId: selectedAlertId }),
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
        body: JSON.stringify({ alertIds, indexPattern: 'selk-suricata-*' }),
      });
      setBulkAiSummary(response);
    } catch (error) {
      setBulkAiError(error instanceof Error ? error.message : '批量 AI 研判失败');
    } finally {
      setBulkAiLoading(false);
    }
  }

  function openRelativeAlert(offset: -1 | 1) {
    if (currentAlertIndex < 0) return;
    const target = hits[currentAlertIndex + offset];
    if (!target) return;
    openAlert(target._id);
  }

  function applyQuickFilter(fieldName: string, value: string, mode: 'include' | 'exclude') {
    const field = fieldMap[fieldName];
    const clause = buildLuceneClause(field, value, mode);
    if (!clause) return;
    setPage(0);
    setQueryInput((current) => appendClause(current, clause));
    setAppliedQuery((current) => appendClause(current, clause));
  }


  if (loadingFields) {
    return <StatusPanel title="告警中心加载中" description="正在读取字段目录与页面配置。" />;
  }

  if (fieldsError) {
    return <StatusPanel title="字段目录加载失败" description={fieldsError} tone="error" />;
  }

  return (
    <section className="page alerts-page">
      <header className="page-header">
        <h1 className="page-title">告警中心</h1>
        <p className="page-description">看告警的地方</p>
      </header>

      <form className="card toolbar alerts-toolbar" onSubmit={handleSubmit}>
        <div className="toolbar-group alerts-query-group">
          <LuceneFieldInput fields={fields} onChange={setQueryInput} placeholder={'输入 Lucene 查询，例如 alert.signature:"system" AND src_ip.keyword:"192.168.52.1"'} value={queryInput} />
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
        <div className="toolbar-group">
          <button className="button button-primary" type="submit">搜索</button>
          <button className="button" type="button" onClick={() => setRefreshNonce((current) => current + 1)}>刷新</button>
          <button className="button" type="button" onClick={() => setSearchHelpOpen((current) => !current)}>{searchHelpOpen ? '收起说明' : '搜索说明'}</button>
        </div>

        {searchHelpOpen ? (
          <div className="search-help-panel">
            <div className="search-help-grid search-help-grid-inline">
              <div className="search-help-example"><span>普通搜索</span><pre className="code code-block">alert.signature:&quot;命令注入&quot;</pre></div>
              <div className="search-help-example"><span>模糊搜索</span><pre className="code code-block">correlated_http.http.url.keyword:&quot;/admin*&quot;</pre></div>
              <div className="search-help-example"><span>逻辑运算符</span><pre className="code code-block">src_ip.keyword:&quot;192.168.52.1&quot; AND alert.severity:1</pre></div>
              <div className="search-help-example"><span>排除条件</span><pre className="code code-block">NOT dest_port:443</pre></div>
            </div>
          </div>
        ) : null}
      </form>

      <div className="alerts-workspace" style={{ gridTemplateColumns: `${sidebarWidth}px 10px minmax(0, 1fr)` }}>
        <aside className="alerts-sidebar">
          <SectionCard title="字段面板" description="点击字段直接查看统计，拖动字段调整列顺序。">
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
            setResizeTarget({
              kind: 'sidebar',
              startX: event.clientX,
              startY: event.clientY,
              startSidebarWidth: sidebarWidth,
              startModalWidth: modalWidth,
              startModalHeight: modalHeight,
            });
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
              <StatusPanel title="搜索中" description="正在从 Elasticsearch 检索告警结果。" />
            ) : resultsError ? (
              <StatusPanel title="搜索失败" description={resultsError} tone="error" />
            ) : hits.length === 0 ? (
              <div className="empty-hint">当前查询条件下没有告警结果。</div>
            ) : (
              <ResultTable
                hits={hits}
                titleField={titleField}
                selectedFields={selectedFields}
                fieldLabels={fieldLabels}
                fieldKeys={fieldKeyMap}
                queryFields={Object.fromEntries(Object.values(fieldMap).map((field) => [field.name, field.queryField]))}
                sortField={sortField}
                sortOrder={sortOrder}
                readAlertIds={readAlertIds}
                columnWidths={columnWidths}
                onSortChange={changeSort}
                onSelectAlert={(hit) => openAlert(hit._id)}
                onReorderColumns={reorderField}
                onColumnWidthChange={(fieldName, width) => {
                  setColumnWidths((current) => ({
                    ...current,
                    [fieldName]: width,
                  }));
                }}
                onQuickFilter={applyQuickFilter}
              />
            )}
          </SectionCard>
        </main>
      </div>

      {selectedAlertId ? (
        <div className="modal-backdrop" onClick={() => setSelectedAlertId(null)} role="presentation">
          <div className="modal-window" style={{ width: `${modalWidth}vw`, height: `${modalHeight}vh`, maxWidth: `${modalWidth}vw`, maxHeight: `${modalHeight}vh` }} onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header modal-header-compact">
              <span className="modal-header-segment modal-header-segment-title" title={detail?.title ?? '告警详情'}>{detail?.title ?? '告警详情'}</span>
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
              {selectedAlertId ? (
                <div className="modal-header-segment">
                  <button className="button" type="button" onClick={() => toggleRead(selectedAlertId)}>
                    {readAlertIds.includes(selectedAlertId) ? '标记未读' : '标记已读'}
                  </button>
                  <button className="button button-primary" type="button" disabled={loadingAi} onClick={() => void runAiAnalysis()}>{loadingAi ? 'AI 研判中...' : 'AI研判'}</button>
                </div>
              ) : null}
              <div className="modal-header-segment">
                <button className="button" type="button" onClick={() => setSelectedAlertId(null)}>关闭</button>
              </div>
            </div>

            {loadingDetail ? (
              <StatusPanel title="详情加载中" description="正在读取告警详情与 HTTP 原文。" />
            ) : detailError ? (
              <StatusPanel title="详情加载失败" description={detailError} tone="error" />
            ) : (
              <div className="modal-tabbed-content">
                <div className="modal-tabs" role="tablist" aria-label="告警详情内容切换">
                  <button className={`modal-tab ${detailTab === 'http' ? 'modal-tab-active' : ''}`} type="button" onClick={() => setDetailTab('http')}>原始 HTTP 报文</button>
                  <button className={`modal-tab ${detailTab === 'ai' ? 'modal-tab-active' : ''}`} type="button" onClick={() => setDetailTab('ai')}>AI 研判</button>
                  <button className={`modal-tab ${detailTab === 'json' ? 'modal-tab-active' : ''}`} type="button" onClick={() => setDetailTab('json')}>原始日志</button>
                </div>
                {detailTab === 'http' ? (
                  <SectionCard title="原始 HTTP 报文" description="请求包中命中的 payload 相关关键片段会直接标红显示。">
                    <HttpPreview request={detail?.http?.request} response={detail?.http?.response} />
                  </SectionCard>
                ) : null}
                {detailTab === 'json' ? (
                  <SectionCard title="原始日志（JSON）" description="保留完整 _source，便于继续排障与字段确认。">
                    <JsonPreview value={detail?.document} emptyText="当前告警没有原始日志内容。" />
                  </SectionCard>
                ) : null}
                {detailTab === 'ai' ? (
                  <SectionCard title="AI 研判结果" description="基于 alert.signature、请求包、请求体、响应包、rule 以及 engine 辅助字段生成。">
                    {loadingAi ? (
                      <StatusPanel title="AI 研判中" description="正在调用 AI 接口生成告警研判结果。" />
                    ) : aiError ? (
                      <StatusPanel title="AI 研判失败" description={aiError} tone="error" />
                    ) : aiResult ? (
                      <div className="section-card">
                        <SectionCard title="结论">
                          <div className="section-card-description">{aiResult.summary || '暂无结论。'}</div>
                        </SectionCard>
                        <SectionCard title="风险判断">
                          <div className="probe-metric-grid">
                            <div className="probe-metric-item">
                              <span className="probe-metric-label">风险等级</span>
                              <strong className="probe-metric-value">{aiResult.judgement.risk_level || '暂无'}</strong>
                            </div>
                            <div className="probe-metric-item">
                              <span className="probe-metric-label">置信度</span>
                              <strong className="probe-metric-value">{aiResult.judgement.confidence || '暂无'}</strong>
                            </div>
                            <div className="probe-metric-item">
                              <span className="probe-metric-label">是否疑似真实攻击</span>
                              <strong className="probe-metric-value">{aiResult.judgement.is_likely_true_positive ? '是' : '否'}</strong>
                            </div>
                            <div className="probe-metric-item">
                              <span className="probe-metric-label">是否疑似攻击成功</span>
                              <strong className="probe-metric-value">{aiResult.judgement.is_likely_successful_attack ? '是' : '否'}</strong>
                            </div>
                          </div>
                        </SectionCard>
                        <SectionCard title="关键证据">
                          {aiResult.evidence.length ? <ul className="list">{aiResult.evidence.map((item) => <li key={item}>{item}</li>)}</ul> : <div className="empty-hint">暂无证据摘要。</div>}
                        </SectionCard>
                        <SectionCard title="分析说明">
                          <div className="probe-metric-grid">
                            <div className="probe-metric-item">
                              <span className="probe-metric-label">攻击意图</span>
                              <strong className="probe-metric-value">{aiResult.analysis.attack_intent || '暂无'}</strong>
                            </div>
                            <div className="probe-metric-item">
                              <span className="probe-metric-label">成功性判断</span>
                              <strong className="probe-metric-value">{aiResult.analysis.success_assessment || '暂无'}</strong>
                            </div>
                            <div className="probe-metric-item">
                              <span className="probe-metric-label">影响范围提示</span>
                              <strong className="probe-metric-value">{aiResult.analysis.scope_hint || '暂无'}</strong>
                            </div>
                            <div className="probe-metric-item">
                              <span className="probe-metric-label">规则一致性</span>
                              <strong className="probe-metric-value">{aiResult.analysis.rule_consistency || '暂无'}</strong>
                            </div>
                          </div>
                        </SectionCard>
                        <SectionCard title="建议动作">
                          {aiResult.recommended_actions.length ? <ul className="list">{aiResult.recommended_actions.map((item) => <li key={item}>{item}</li>)}</ul> : <div className="empty-hint">暂无建议动作。</div>}
                        </SectionCard>
                      </div>
                    ) : (
                      <div className="empty-hint">点击上方“AI研判”按钮开始分析当前告警。</div>
                    )}
                  </SectionCard>
                ) : null}
              </div>
            )}
            <div
              className="modal-resize-handle"
              onMouseDown={(event) => {
                event.preventDefault();
                setResizeTarget({
                  kind: 'modal',
                  startX: event.clientX,
                  startY: event.clientY,
                  startSidebarWidth: sidebarWidth,
                  startModalWidth: modalWidth,
                  startModalHeight: modalHeight,
                });
              }}
            />
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
