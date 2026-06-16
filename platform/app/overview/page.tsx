'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import SectionCard from '@/components/SectionCard';
import StatusPanel from '@/components/StatusPanel';

type ClusterHealth = {
  status?: string;
  cluster_name?: string;
  number_of_nodes?: number;
  active_primary_shards?: number;
  unassigned_shards?: number;
};

type IndexRow = {
  index: string;
  health?: string;
  'docs.count'?: string;
};

type RuntimeComponent = {
  name: string;
  status?: 'healthy' | 'degraded' | 'down' | 'unknown';
  message?: string;
  unit?: string;
  activeState?: string;
  subState?: string;
  pid?: number;
  startedAt?: string;
  lastActivityAt?: string;
  logPath?: string;
  evidencePath?: string;
  healthUrl?: string;
  readyUrl?: string;
};

type RuntimeCommand = {
  executedAt?: string;
  requestedAt?: string;
  action?: string;
  target?: string;
  reason?: string;
  message?: string;
  status?: 'succeeded' | 'failed';
  units?: string[];
};

type SystemUsage = {
  cpu?: {
    usagePercent?: number | null;
    loadAverage?: { one?: number; five?: number; fifteen?: number };
  };
  memory?: {
    totalBytes?: number;
    availableBytes?: number;
    usedBytes?: number;
    usagePercent?: number | null;
  };
  disk?: {
    root?: { path?: string; totalBytes?: number; usedBytes?: number; freeBytes?: number; usagePercent?: number | null };
    probeProd?: { path?: string; totalBytes?: number; usedBytes?: number; freeBytes?: number; usagePercent?: number | null };
  };
};

type RuntimeSummary = {
  generatedAt?: string;
  probeProdRoot?: string;
  statusPath?: string;
  metricsPath?: string;
  controlPath?: string;
  monitorBaseUrl?: string;
  probeDisplayName?: string;
  lastCommand?: RuntimeCommand;
  system?: SystemUsage;
  probe?: RuntimeComponent;
  engine?: RuntimeComponent;
  kafka?: RuntimeComponent;
  suricata?: RuntimeComponent;
};

type OverviewSummary = {
  cluster?: ClusterHealth;
  indices?: IndexRow[];
  alerts?: {
    hits?: {
      total?: {
        value?: number;
        relation?: string;
      };
    };
  };
  runtime?: RuntimeSummary;
};

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
    cache: 'no-store',
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message ?? '请求失败');
  }
  return payload as T;
}

function formatCount(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function totalDocs(indices: IndexRow[]) {
  return indices.reduce((sum, item) => sum + Number(item['docs.count'] ?? 0), 0);
}

function alertTotal(summary: OverviewSummary) {
  const total = summary.alerts?.hits?.total?.value ?? 0;
  return summary.alerts?.hits?.total?.relation === 'gte' ? `${formatCount(total)}+` : formatCount(total);
}

function statusTone(status?: string) {
  if (status === 'green' || status === 'healthy') return 'status-green';
  if (status === 'yellow' || status === 'degraded') return 'status-yellow';
  if (status === 'red' || status === 'down') return 'status-red';
  return 'status-gray';
}

function formatTime(value?: string) {
  if (!value) return '暂无';
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp));
}

function formatPercent(value?: number | null) {
  return typeof value === 'number' ? `${value.toFixed(2)}%` : '暂无';
}

function formatBytes(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '暂无';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let current = value;
  let index = 0;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${current.toFixed(current >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function commandText(command?: RuntimeCommand) {
  if (!command) return '最近尚未执行运行控制命令';
  const outcome = command.status === 'succeeded' ? '成功' : command.status === 'failed' ? '失败' : '未知';
  return `${command.action ?? 'unknown'} ${command.target ?? 'unknown'} - ${outcome} - ${command.message ?? '无详情'}`;
}

function RuntimeCard({ component }: { component?: RuntimeComponent }) {
  return (
    <article className="card stat-card">
      <div className="stat-label">{component?.name ?? 'Unknown'}</div>
      <div className="toolbar-group">
        <span className={`status-pill ${statusTone(component?.status)}`}>{component?.status ?? 'unknown'}</span>
        {component?.unit ? <span className="muted">{component.unit}</span> : null}
      </div>
      <div className="stat-subtext">{component?.message ?? '暂无运行状态'}</div>
      <div className="stat-subtext">PID: {component?.pid ?? '-'}</div>
      <div className="stat-subtext">最近活动: {formatTime(component?.lastActivityAt)}</div>
    </article>
  );
}

export default function OverviewPage() {
  const [data, setData] = useState<OverviewSummary | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');
  const [restartingTarget, setRestartingTarget] = useState<string | null>(null);

  async function loadOverview() {
    try {
      setLoading(true);
      setError('');
      const response = await fetchJson<OverviewSummary>('/api/overview/summary');
      setData(response);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '概览加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOverview();
  }, []);

  async function restartRuntime(target: 'probe' | 'engine' | 'all') {
    try {
      setRestartingTarget(target);
      setActionError('');
      setActionSuccess('');
      const response = await fetchJson<{ command?: RuntimeCommand; message?: string }>('/api/runtime/restart', {
        method: 'POST',
        body: JSON.stringify({ target, reason: 'overview' }),
      });
      setActionSuccess(response.command?.message ?? response.message ?? `${target} 重启请求已发送`);
      await loadOverview();
    } catch (restartError) {
      setActionError(restartError instanceof Error ? restartError.message : '重启失败');
    } finally {
      setRestartingTarget(null);
    }
  }

  if (loading && !data) {
    return <StatusPanel title="概览加载中" description="正在读取 Elasticsearch 和探针运行状态。" />;
  }

  if (error && !data) {
    return <StatusPanel title="概览加载失败" description={error} tone="error" />;
  }

  const summary = data ?? {};
  const indices = summary.indices ?? [];
  const runtime = summary.runtime;

  return (
    <section className="page overview-page">
      <header className="page-header">
        <h1 className="page-title">JustSoc 总览</h1>
        <p className="page-description">集中查看 Elasticsearch、告警数据和探针侧运行状态。</p>
      </header>

      {error ? <div className="status-inline status-inline-error">{error}</div> : null}
      {actionError ? <div className="status-inline status-inline-error">{actionError}</div> : null}
      {actionSuccess ? <div className="status-inline status-inline-success">{actionSuccess}</div> : null}

      <div className="state-grid">
        <article className="card stat-card">
          <div className="stat-label">ES 集群</div>
          <div className="toolbar-group">
            <span className={`status-pill ${statusTone(summary.cluster?.status)}`}>{summary.cluster?.status ?? 'unknown'}</span>
            <span className="muted">{summary.cluster?.cluster_name ?? 'unknown'}</span>
          </div>
          <div className="stat-subtext">节点数：{summary.cluster?.number_of_nodes ?? '-'}</div>
          <div className="stat-subtext">主分片：{summary.cluster?.active_primary_shards ?? '-'}</div>
          <div className="stat-subtext">未分配分片：{summary.cluster?.unassigned_shards ?? '-'}</div>
        </article>

        <article className="card stat-card">
          <div className="stat-label">SELK 索引</div>
          <div className="stat-value">{formatCount(indices.length)}</div>
          <div className="stat-subtext">文档总量：{formatCount(totalDocs(indices))}</div>
        </article>

        <article className="card stat-card">
          <div className="stat-label">告警总量</div>
          <div className="stat-value">{alertTotal(summary)}</div>
          <div className="stat-subtext">来自 selk-* 中 event_type=alert 的结果</div>
        </article>

        <article className="card stat-card">
          <div className="stat-label">探针主机</div>
          <div className="stat-value">{runtime?.probeDisplayName ?? '未配置'}</div>
          <div className="stat-subtext">{runtime?.monitorBaseUrl ?? 'monitor 未连接'}</div>
        </article>
      </div>

      <SectionCard
        title="探针运行状态"
        description={`状态生成时间：${formatTime(runtime?.generatedAt)}。最近命令：${commandText(runtime?.lastCommand)}`}
        actions={
          <div className="toolbar-group">
            <button className="button" type="button" onClick={() => void loadOverview()} disabled={loading}>{loading ? '刷新中...' : '刷新'}</button>
            <button className="button" type="button" onClick={() => void restartRuntime('probe')} disabled={Boolean(restartingTarget)}>{restartingTarget === 'probe' ? '重启 Probe 中...' : '重启 Probe'}</button>
            <button className="button" type="button" onClick={() => void restartRuntime('engine')} disabled={Boolean(restartingTarget)}>{restartingTarget === 'engine' ? '重启 Engine 中...' : '重启 Engine'}</button>
            <button className="button button-primary" type="button" onClick={() => void restartRuntime('all')} disabled={Boolean(restartingTarget)}>{restartingTarget === 'all' ? '重启全部中...' : '重启全部'}</button>
          </div>
        }
      >
        <div className="state-grid">
          <RuntimeCard component={runtime?.probe} />
          <RuntimeCard component={runtime?.engine} />
          <RuntimeCard component={runtime?.kafka} />
          <RuntimeCard component={runtime?.suricata} />
        </div>
      </SectionCard>

      <SectionCard title="系统资源" description="来自探针侧 probe-dispatcher 暴露的运行指标。">
        <div className="probe-metric-grid">
          <div className="probe-metric-item"><span className="probe-metric-label">CPU 使用率</span><strong className="probe-metric-value">{formatPercent(runtime?.system?.cpu?.usagePercent)}</strong></div>
          <div className="probe-metric-item"><span className="probe-metric-label">内存使用率</span><strong className="probe-metric-value">{formatPercent(runtime?.system?.memory?.usagePercent)}</strong></div>
          <div className="probe-metric-item"><span className="probe-metric-label">根分区</span><strong className="probe-metric-value">{formatPercent(runtime?.system?.disk?.root?.usagePercent)}</strong></div>
          <div className="probe-metric-item"><span className="probe-metric-label">探针目录</span><strong className="probe-metric-value">{formatPercent(runtime?.system?.disk?.probeProd?.usagePercent)}</strong></div>
          <div className="probe-metric-item"><span className="probe-metric-label">内存已用</span><strong className="probe-metric-value">{formatBytes(runtime?.system?.memory?.usedBytes)}</strong></div>
          <div className="probe-metric-item"><span className="probe-metric-label">探针目录已用</span><strong className="probe-metric-value">{formatBytes(runtime?.system?.disk?.probeProd?.usedBytes)}</strong></div>
        </div>
      </SectionCard>

      <SectionCard
        title="快速入口"
        description="继续查看告警、日志、资产和设置。"
        actions={
          <div className="toolbar-group">
            <Link className="button" href="/alerts">告警中心</Link>
            <Link className="button" href="/logs">日志中心</Link>
            <Link className="button" href="/assets">资产管理</Link>
            <Link className="button" href="/settings">设置</Link>
          </div>
        }
      >
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>索引</th><th>健康</th><th>文档数</th></tr>
            </thead>
            <tbody>
              {indices.slice(0, 12).map((item) => (
                <tr key={item.index}>
                  <td>{item.index}</td>
                  <td><span className={`status-pill ${statusTone(item.health)}`}>{item.health ?? 'unknown'}</span></td>
                  <td>{formatCount(Number(item['docs.count'] ?? 0))}</td>
                </tr>
              ))}
              {indices.length === 0 ? <tr><td colSpan={3}>暂无 JustSoc 索引</td></tr> : null}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </section>
  );
}
