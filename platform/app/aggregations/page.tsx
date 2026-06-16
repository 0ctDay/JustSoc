'use client';

import type { FormEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import AlertDetailModal, { type AlertDetailModalAiAnalysisResult, type AlertDetailModalDetail } from '@/components/AlertDetailModal';
import ResultTable from '@/components/ResultTable';
import SectionCard from '@/components/SectionCard';
import StatusPanel from '@/components/StatusPanel';
import type { AlertFieldDefinition } from '@/lib/alert-fields';
import { ALERT_TITLE_FIELD_KEY } from '@/lib/alert-field-mapping-schema';

function useSidePanelAnim(open: boolean, onClose?: () => void) {
  const [visible, setVisible] = useState(open);
  const [anim, setAnim] = useState(open ? 'enter' : 'idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (open) {
      setVisible(true);
      setAnim('enter');
    } else if (visible) {
      setAnim('leaving');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setVisible(false);
        setAnim('idle');
        onCloseRef.current?.();
      }, 260);
    }
  }, [open, visible]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return {
    visible,
    windowCls: anim === 'leaving' ? 'side-window-anim-leave' : 'side-window-anim-enter',
  };
}

type RuntimeMonitorSettings = {
  aggregationWindowMinutes: number;
};

type AlertHit = {
  _id: string;
  _index: string;
  _source?: Record<string, unknown>;
};

type AggregationItem = {
  bucketKey: string;
  windowStart: string;
  windowEnd: string;
  srcIp: string;
  selkCategory: string;
  totalAlerts: number;
  successfulAlerts: number;
  attackResult: string;
  title: string;
};

type AggregationAgentContextResponse = {
  title: string;
  prompt: string;
  hiddenPrompt: string;
  summary: {
    totalAlerts: number;
    successfulAlerts: number;
    attackResult: string;
    topSignatures: Array<{ value: string; count: number }>;
    topDestinationIps: Array<{ value: string; count: number }>;
    sampleCount: number;
  };
};

type AlertDetail = AlertDetailModalDetail & {
  aiAnalysis?: {
    result: AlertDetailModalAiAnalysisResult;
  } | null;
};

const DEFAULT_AGGREGATION_FIELD_KEYS = [
  'timestamp',
  'srcIp',
  'destIp',
  'destPort',
  'eventSeverity',
  'attackCategory',
  'attackSuccess',
] as const;

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
  else if (option === 'custom') {
    const from = customFrom ? new Date(customFrom).toISOString() : start.toISOString();
    const to = customTo ? new Date(customTo).toISOString() : end;
    return { from, to };
  }

  return { from: start.toISOString(), to: end };
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message ?? '请求失败');
  }
  return payload as T;
}

function formatWindow(start: string, end: string) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${formatter.format(startDate)} - ${formatter.format(endDate)}`;
}

function uniqueFieldNames(fieldNames: string[]) {
  return fieldNames.filter((fieldName, index) => fieldNames.indexOf(fieldName) === index);
}

export default function AlertAggregationsPage() {
  const [fields, setFields] = useState<AlertFieldDefinition[]>([]);
  const [loadingFields, setLoadingFields] = useState(true);
  const [fieldsError, setFieldsError] = useState('');

  const [queryInput, setQueryInput] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [timeRange, setTimeRange] = useState('24h');
  const [customFrom, setCustomFrom] = useState(() => toDateTimeLocalValue(new Date(Date.now() - 24 * 60 * 60 * 1000)));
  const [customTo, setCustomTo] = useState(() => toDateTimeLocalValue(new Date()));
  const [windowMinutes, setWindowMinutes] = useState(20);

  const [items, setItems] = useState<AggregationItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [itemsError, setItemsError] = useState('');
  const [refreshNonce, setRefreshNonce] = useState(0);

  const [selectedBucket, setSelectedBucket] = useState<AggregationItem | null>(null);
  const bucketAnim = useSidePanelAnim(selectedBucket !== null, () => setSelectedBucket(null));
  const [bucketHits, setBucketHits] = useState<AlertHit[]>([]);
  const [bucketLoading, setBucketLoading] = useState(false);
  const [bucketError, setBucketError] = useState('');
  const [bucketAgentLaunching, setBucketAgentLaunching] = useState(false);
  const [bucketAgentError, setBucketAgentError] = useState('');
  const [bucketAgentTaskId, setBucketAgentTaskId] = useState<string | null>(null);
  const [bucketSummaryLoading, setBucketSummaryLoading] = useState(false);
  const [bucketAgentContext, setBucketAgentContext] = useState<AggregationAgentContextResponse | null>(null);

  const [bucketSelectedFields, setBucketSelectedFields] = useState<string[]>([]);
  const [bucketFieldsHydrated, setBucketFieldsHydrated] = useState(false);
  const [bucketFieldPickerOpen, setBucketFieldPickerOpen] = useState(false);

  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AlertDetail | null>(null);
  const [detailError, setDetailError] = useState('');
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailTab, setDetailTab] = useState<'http' | 'fields' | 'json' | 'ai'>('http');
  const [aiResult, setAiResult] = useState<AlertDetailModalAiAnalysisResult | null>(null);
  const [aiError, setAiError] = useState('');
  const [loadingAi, setLoadingAi] = useState(false);

  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({ 'alert.signature': 260 });
  const bucketFieldPickerRef = useRef<HTMLDivElement | null>(null);
  const bucketFieldPickerButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    async function loadBootstrap() {
      try {
        setLoadingFields(true);
        setFieldsError('');
        const [fieldsResponse, settingsResponse] = await Promise.all([
          fetchJson<AlertFieldDefinition[]>('/api/alerts/fields'),
          fetchJson<{ settings: RuntimeMonitorSettings }>('/api/settings/runtime-monitor'),
        ]);
        setFields(fieldsResponse);
        setWindowMinutes(settingsResponse.settings.aggregationWindowMinutes ?? 20);
      } catch (error) {
        setFieldsError(error instanceof Error ? error.message : '聚合页初始化失败');
      } finally {
        setLoadingFields(false);
      }
    }

    void loadBootstrap();
  }, []);

  const aggregationBody = useMemo(() => ({
    query: appliedQuery,
    querySyntax: 'lucene',
    timeRange: buildTimeRange(timeRange, customFrom, customTo),
    windowMinutes,
    size: 200,
  }), [appliedQuery, timeRange, customFrom, customTo, windowMinutes, refreshNonce]);

  useEffect(() => {
    async function loadAggregations() {
      try {
        setLoadingItems(true);
        setItemsError('');
        const response = await fetchJson<{ items: AggregationItem[] }>('/api/alerts/aggregations', {
          method: 'POST',
          body: JSON.stringify(aggregationBody),
        });
        setItems(response.items ?? []);
      } catch (error) {
        setItemsError(error instanceof Error ? error.message : '聚合结果加载失败');
      } finally {
        setLoadingItems(false);
      }
    }

    void loadAggregations();
  }, [aggregationBody, refreshNonce]);

  useEffect(() => {
    if (!selectedBucket) return;
    const bucket = selectedBucket;

    async function loadBucketDetail() {
      try {
        setBucketLoading(true);
        setBucketError('');
        const response = await fetchJson<{ hits?: { hits?: AlertHit[] } }>('/api/alerts/aggregations/detail', {
          method: 'POST',
          body: JSON.stringify({
            windowStart: bucket.windowStart,
            windowEnd: bucket.windowEnd,
            srcIp: bucket.srcIp,
            selkCategory: bucket.selkCategory,
          }),
        });
        setBucketHits(response.hits?.hits ?? []);
      } catch (error) {
        setBucketError(error instanceof Error ? error.message : '聚合明细加载失败');
      } finally {
        setBucketLoading(false);
      }
    }

    void loadBucketDetail();
  }, [selectedBucket]);

  useEffect(() => {
    if (!selectedAlertId) return;

    async function loadDetail() {
      try {
        setLoadingDetail(true);
        setDetailError('');
        const response = await fetchJson<AlertDetail>(`/api/alerts/${selectedAlertId}/detail`);
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
    if (!selectedAlertId) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedAlertId(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedAlertId]);

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
  const titleQueryField = fieldByKey[ALERT_TITLE_FIELD_KEY]?.queryField ?? 'alert.signature';
  const srcIpQueryField = fieldByKey.srcIp?.queryField ?? 'src_ip.keyword';

  const bucketFieldOptions = useMemo(
    () => fields.filter((field) => !field.detailOnly && field.name !== titleField),
    [fields, titleField],
  );

  const bucketFieldOptionNames = useMemo(
    () => bucketFieldOptions.map((field) => field.name),
    [bucketFieldOptions],
  );

  const bucketFieldOrder = useMemo(() => {
    const map = new Map<string, number>();
    bucketFieldOptionNames.forEach((fieldName, index) => {
      map.set(fieldName, index);
    });
    return map;
  }, [bucketFieldOptionNames]);

  const defaultBucketFields = useMemo(
    () => bucketFieldOptions
      .filter((field) => DEFAULT_AGGREGATION_FIELD_KEYS.includes(field.key as typeof DEFAULT_AGGREGATION_FIELD_KEYS[number]))
      .map((field) => field.name),
    [bucketFieldOptions],
  );

  const selectedFields = useMemo(
    () => bucketSelectedFields.filter((fieldName) => bucketFieldOrder.has(fieldName)),
    [bucketFieldOrder, bucketSelectedFields],
  );

  const queryFields = useMemo(
    () => Object.fromEntries(Object.values(fieldMap).map((field) => [field.name, field.queryField])),
    [fieldMap],
  );

  useEffect(() => {
    if (!bucketFieldOptionNames.length) return;
    setBucketSelectedFields((current) => {
      if (!bucketFieldsHydrated) {
        return defaultBucketFields;
      }
      return uniqueFieldNames(current.filter((fieldName) => bucketFieldOrder.has(fieldName)));
    });
    if (!bucketFieldsHydrated) {
      setBucketFieldsHydrated(true);
    }
  }, [bucketFieldOptionNames, bucketFieldOrder, bucketFieldsHydrated, defaultBucketFields]);

  useEffect(() => {
    if (!bucketFieldPickerOpen) return undefined;

    function closeOnOutsideClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (bucketFieldPickerRef.current?.contains(target)) return;
      if (bucketFieldPickerButtonRef.current?.contains(target)) return;
      setBucketFieldPickerOpen(false);
    }

    window.addEventListener('mousedown', closeOnOutsideClick);
    return () => window.removeEventListener('mousedown', closeOnOutsideClick);
  }, [bucketFieldPickerOpen]);

  useEffect(() => {
    if (!selectedBucket) {
      setBucketFieldPickerOpen(false);
      setBucketAgentError('');
      setBucketAgentTaskId(null);
      setBucketAgentContext(null);
    }
  }, [selectedBucket]);

  useEffect(() => {
    if (!selectedBucket) return;
    const bucket = selectedBucket;
    let cancelled = false;

    async function loadAgentState() {
      try {
        setBucketSummaryLoading(true);
        const [mappingResponse, contextResponse] = await Promise.all([
          fetchJson<{ mapping: { taskId: string } | null }>(`/api/alerts/aggregations/agent-task?bucketKey=${encodeURIComponent(bucket.bucketKey)}`),
          fetchJson<AggregationAgentContextResponse>('/api/alerts/aggregations/context', {
            method: 'POST',
            body: JSON.stringify({
              windowStart: bucket.windowStart,
              windowEnd: bucket.windowEnd,
              srcIp: bucket.srcIp,
              selkCategory: bucket.selkCategory,
              totalAlerts: bucket.totalAlerts,
              successfulAlerts: bucket.successfulAlerts,
              attackResult: bucket.attackResult,
              title: bucket.title,
            }),
          }),
        ]);

        if (cancelled) return;
        setBucketAgentTaskId(mappingResponse.mapping?.taskId ?? null);
        setBucketAgentContext(contextResponse);
      } catch (error) {
        if (cancelled) return;
        setBucketAgentError(error instanceof Error ? error.message : '聚合研判上下文加载失败');
      } finally {
        if (!cancelled) {
          setBucketSummaryLoading(false);
        }
      }
    }

    void loadAgentState();
    return () => {
      cancelled = true;
    };
  }, [selectedBucket]);

  async function runAiAnalysis() {
    if (!selectedAlertId) return;
    try {
      setLoadingAi(true);
      setAiError('');
      setDetailTab('ai');
      const response = await fetchJson<{ result: { result: AlertDetailModalAiAnalysisResult } }>('/api/ai/analyze-alert', {
        method: 'POST',
        body: JSON.stringify({ alertId: selectedAlertId, force: true }),
      });
      setAiResult(response.result.result);
      const refreshed = await fetchJson<AlertDetail>(`/api/alerts/${selectedAlertId}/detail`);
      setDetail(refreshed);
      setAiResult(refreshed.aiAnalysis?.result ?? response.result.result);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'AI 研判失败');
    } finally {
      setLoadingAi(false);
    }
  }

  async function runBucketAgentAnalysis() {
    if (!selectedBucket) return;

    try {
      setBucketAgentLaunching(true);
      setBucketAgentError('');
      const context = bucketAgentContext ?? await fetchJson<AggregationAgentContextResponse>('/api/alerts/aggregations/context', {
        method: 'POST',
        body: JSON.stringify({
          windowStart: selectedBucket.windowStart,
          windowEnd: selectedBucket.windowEnd,
          srcIp: selectedBucket.srcIp,
          selkCategory: selectedBucket.selkCategory,
          totalAlerts: selectedBucket.totalAlerts,
          successfulAlerts: selectedBucket.successfulAlerts,
          attackResult: selectedBucket.attackResult,
          title: selectedBucket.title,
        }),
      });

      const taskResponse = await fetchJson<{ task: { id: string; title: string } }>('/api/claude-bridge/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: context.title,
          prompt: context.prompt,
          hiddenPrompt: context.hiddenPrompt,
        }),
      });

      await fetchJson('/api/alerts/aggregations/agent-task', {
        method: 'POST',
        body: JSON.stringify({
          bucketKey: selectedBucket.bucketKey,
          taskId: taskResponse.task.id,
          title: context.title,
          windowStart: selectedBucket.windowStart,
          windowEnd: selectedBucket.windowEnd,
          srcIp: selectedBucket.srcIp,
          selkCategory: selectedBucket.selkCategory,
        }),
      });

      setBucketAgentTaskId(taskResponse.task.id);
      setBucketAgentContext(context);

      window.dispatchEvent(new CustomEvent('justsoc-claude-bridge-open-task', {
        detail: {
          taskId: taskResponse.task.id,
        },
      }));
    } catch (error) {
      setBucketAgentError(error instanceof Error ? error.message : 'Agent 研判启动失败');
    } finally {
      setBucketAgentLaunching(false);
    }
  }

  function continueBucketAgentAnalysis() {
    if (!bucketAgentTaskId) return;
    window.dispatchEvent(new CustomEvent('justsoc-claude-bridge-open-task', {
      detail: {
        taskId: bucketAgentTaskId,
      },
    }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAppliedQuery(queryInput.trim());
  }

  function toggleBucketField(fieldName: string) {
    setBucketSelectedFields((current) => {
      if (current.includes(fieldName)) {
        return current.filter((item) => item !== fieldName);
      }
      return [...current, fieldName].sort((left, right) => (bucketFieldOrder.get(left) ?? 999) - (bucketFieldOrder.get(right) ?? 999));
    });
  }

  function resetBucketFields() {
    setBucketSelectedFields(defaultBucketFields);
  }

  if (loadingFields) {
    return <StatusPanel title="告警聚合加载中" description="正在读取字段目录和聚合配置。" />;
  }

  if (fieldsError) {
    return <StatusPanel title="聚合页初始化失败" description={fieldsError} tone="error" />;
  }

  return (
    <section className="page">
      <header className="page-header">
        <h1 className="page-title">告警聚合</h1>
        <p className="page-description">按分钟时间窗、统一源 IP 和攻击类型聚合告警，并快速下钻查看相关原始告警。</p>
      </header>

      <form className="card toolbar alerts-toolbar" onSubmit={handleSubmit}>
        <div className="toolbar-group alerts-query-group">
          <input
            className="input alerts-query-input"
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
            placeholder={`输入 Lucene 查询，例如 ${srcIpQueryField}:"192.168.52.1" AND ${titleQueryField}:"SQL"`}
          />
          <select className="input alerts-time-select" value={timeRange} onChange={(event) => setTimeRange(event.target.value)}>
            <option value="1h">最近 1 小时</option>
            <option value="6h">最近 6 小时</option>
            <option value="24h">最近 24 小时</option>
            <option value="7d">最近 7 天</option>
            <option value="custom">自由选择</option>
          </select>
          {timeRange === 'custom' ? (
            <>
              <input className="input alerts-time-input" type="datetime-local" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} />
              <input className="input alerts-time-input" type="datetime-local" value={customTo} onChange={(event) => setCustomTo(event.target.value)} />
            </>
          ) : null}
          <span className="muted">默认聚合窗口 {windowMinutes} 分钟</span>
        </div>
        <div className="toolbar-group">
          <button className="button button-primary" type="submit">搜索</button>
          <button className="button" type="button" onClick={() => setRefreshNonce((current) => current + 1)}>刷新</button>
        </div>
      </form>

      <SectionCard title="聚合结果" description={`当前窗口下共 ${items.length.toLocaleString('zh-CN')} 条聚合结果。`}>
        {loadingItems ? (
          <StatusPanel title="聚合中" description="正在从 Elasticsearch 计算聚合结果。" />
        ) : itemsError ? (
          <StatusPanel title="聚合失败" description={itemsError} tone="error" />
        ) : items.length === 0 ? (
          <div className="empty-hint">当前条件下没有聚合结果。</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>标题</th>
                  <th>源 IP</th>
                  <th>攻击类型</th>
                  <th>时间窗口</th>
                  <th>告警数</th>
                  <th>成功事件数</th>
                  <th>攻击结果</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.bucketKey}>
                    <td><button className="table-row-button" type="button" onClick={() => setSelectedBucket(item)}>{item.title}</button></td>
                    <td>{item.srcIp}</td>
                    <td>{item.selkCategory}</td>
                    <td>{formatWindow(item.windowStart, item.windowEnd)}</td>
                    <td>{item.totalAlerts.toLocaleString('zh-CN')}</td>
                    <td>{item.successfulAlerts.toLocaleString('zh-CN')}</td>
                    <td><span className={`status-pill ${item.attackResult === '成功' ? 'status-red' : 'status-gray'}`}>{item.attackResult}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {bucketAnim.visible ? (
        <div className="modal-backdrop modal-backdrop-anim-enter" onClick={() => setSelectedBucket(null)} role="presentation">
          <div className={`aggregation-side-window ${bucketAnim.windowCls}`} onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            {selectedBucket ? (
              <>
            <div className="modal-header">
              <div>
                <div className="modal-title">聚合明细</div>
                <div className="muted">{selectedBucket?.title}</div>
              </div>
              <div className="aggregation-side-header-actions">
                <button
                  ref={bucketFieldPickerButtonRef}
                  className="button"
                  type="button"
                  onClick={() => setBucketFieldPickerOpen((current) => !current)}
                >
                  {`字段${selectedFields.length ? ` (${selectedFields.length})` : ''}`}
                </button>
                <button className="button" type="button" onClick={() => setSelectedBucket(null)}>关闭</button>
                {bucketFieldPickerOpen ? (
                  <div ref={bucketFieldPickerRef} className="aggregation-field-picker">
                    <div className="aggregation-field-picker-header">
                      <div>
                        <div className="field-section-title">显示字段</div>
                        <div className="muted">标题列固定显示，下面字段可随时开关。</div>
                      </div>
                      <button className="link-button" type="button" onClick={resetBucketFields}>恢复默认</button>
                    </div>
                    <div className="aggregation-field-picker-list">
                      {bucketFieldOptions.map((field) => {
                        const checked = selectedFields.includes(field.name);
                        return (
                          <label className="aggregation-field-option" key={field.name}>
                            <input checked={checked} type="checkbox" onChange={() => toggleBucketField(field.name)} />
                            <span className="aggregation-field-option-body">
                              <span className="aggregation-field-option-label">{field.label}</span>
                              <span className="aggregation-field-option-name">{field.name}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            {bucketLoading ? (
              <StatusPanel title="明细加载中" description="正在读取该聚合结果下的所有相关告警。" />
            ) : bucketError ? (
              <StatusPanel title="明细加载失败" description={bucketError} tone="error" />
            ) : bucketHits.length === 0 ? (
              <div className="empty-hint">当前聚合结果下没有相关告警。</div>
            ) : (
              <>
                {bucketAgentError ? <div className="status-inline status-inline-error" style={{ marginBottom: 12 }}>{bucketAgentError}</div> : null}
                <SectionCard
                  title="聚合摘要"
                  description={bucketSummaryLoading ? '正在生成聚合级摘要...' : bucketAgentTaskId ? '该聚合桶已存在历史 Agent 任务，可直接继续研判。' : '首次点击 Agent 研判会基于这些摘要和代表样本创建任务。'}
                  actions={bucketAgentTaskId ? (
                    <>
                      <button className="button button-primary" type="button" disabled={bucketAgentLaunching} onClick={() => void continueBucketAgentAnalysis()}>
                        继续研判
                      </button>
                      <button className="button" type="button" disabled={bucketAgentLaunching} onClick={() => void runBucketAgentAnalysis()}>
                        {bucketAgentLaunching ? '新建中...' : '新建研判'}
                      </button>
                    </>
                  ) : (
                    <button className="button button-primary" type="button" disabled={bucketAgentLaunching} onClick={() => void runBucketAgentAnalysis()}>
                      {bucketAgentLaunching ? 'Agent 研判中...' : 'Agent 研判'}
                    </button>
                  )}
                >
                  <div className="probe-metric-grid">
                    <div className="probe-metric-item">
                      <span className="probe-metric-label">总告警数</span>
                      <strong className="probe-metric-value">{selectedBucket.totalAlerts.toLocaleString('zh-CN')}</strong>
                    </div>
                    <div className="probe-metric-item">
                      <span className="probe-metric-label">成功告警数</span>
                      <strong className="probe-metric-value">{selectedBucket.successfulAlerts.toLocaleString('zh-CN')}</strong>
                    </div>
                    <div className="probe-metric-item">
                      <span className="probe-metric-label">攻击结果</span>
                      <strong className="probe-metric-value">{selectedBucket.attackResult}</strong>
                    </div>
                    <div className="probe-metric-item">
                      <span className="probe-metric-label">代表样本数</span>
                      <strong className="probe-metric-value">{bucketAgentContext?.summary.sampleCount ?? '-'}</strong>
                    </div>
                  </div>
                  {bucketAgentContext ? (
                    <div className="probe-metric-grid">
                      <div className="probe-metric-item">
                        <span className="probe-metric-label">高频规则</span>
                        <strong className="probe-metric-value">
                          {bucketAgentContext.summary.topSignatures.length
                            ? bucketAgentContext.summary.topSignatures.map((item) => `${item.value} (${item.count})`).join(' / ')
                            : '暂无'}
                        </strong>
                      </div>
                      <div className="probe-metric-item">
                        <span className="probe-metric-label">主要目标 IP</span>
                        <strong className="probe-metric-value">
                          {bucketAgentContext.summary.topDestinationIps.length
                            ? bucketAgentContext.summary.topDestinationIps.map((item) => `${item.value} (${item.count})`).join(' / ')
                            : '暂无'}
                        </strong>
                      </div>
                    </div>
                  ) : null}
                </SectionCard>
                <ResultTable
                  hits={bucketHits}
                  titleField={titleField}
                  selectedFields={[...selectedFields]}
                  fieldLabels={fieldLabels}
                  fieldKeys={fieldKeyMap}
                  queryFields={queryFields}
                  sortField="@timestamp"
                  sortOrder="desc"
                  readAlertIds={[]}
                  columnWidths={columnWidths}
                  onSortChange={() => undefined}
                  onSelectAlert={(hit) => setSelectedAlertId(hit._id)}
                  onReorderColumns={() => undefined}
                  onColumnWidthChange={(fieldName, width) => setColumnWidths((current) => ({ ...current, [fieldName]: width }))}
                  onQuickFilter={() => undefined}
                />
              </>
            )}
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      <AlertDetailModal
        open={Boolean(selectedAlertId)}
        detail={detail}
        detailError={detailError}
        loadingDetail={loadingDetail}
        detailTab={detailTab}
        setDetailTab={setDetailTab}
        aiResult={aiResult}
        aiError={aiError}
        loadingAi={loadingAi}
        onRunAiAnalysis={() => void runAiAnalysis()}
        onClose={() => setSelectedAlertId(null)}
        fields={fields}
        anchorY={null}
        modalStyle={{ width: '70vw', maxWidth: '95vw' }}
      />
    </section>
  );
}