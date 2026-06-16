'use client';

import { Fragment, FormEvent, useEffect, useMemo, useState } from 'react';
import SectionCard from '@/components/SectionCard';
import StatusPanel from '@/components/StatusPanel';

type AssetDocumentRecord = {
  documentId: string;
  documentName: string;
  description?: string;
  schemaVersion: number;
  assetVersion: string;
  yamlContent: string;
  checksumSha256: string;
  createdAt: string;
  updatedAt: string;
};

type AssetPublishLogRecord = {
  publishId: string;
  documentId: string;
  probeId: string;
  status: string;
  responseStatus?: number;
  errorMessage?: string;
  appliedVersion?: string;
  createdAt: string;
  completedAt?: string;
};

type ProbeDispatcherTargetRecord = {
  probeId: string;
  displayName: string;
  enabled: boolean;
};

type DispatcherDocumentsResponse = {
  documents?: AssetDocumentRecord[];
  publishLogs?: AssetPublishLogRecord[];
  message?: string;
};

type DispatcherTargetsResponse = {
  targets?: ProbeDispatcherTargetRecord[];
  message?: string;
};

type SessionResponse = {
  session?: {
    permissions?: string[];
  } | null;
};

type AssetMatchType = 'ip' | 'cidr';
type AssetNetworkType = 'internal' | 'external';

type AssetBindingForm = {
  clientId: string;
  bindingId: string;
  matchType: AssetMatchType;
  matchValue: string;
  networkType: AssetNetworkType;
  priority: string;
  enabled: boolean;
};

type AssetEntryForm = {
  clientId: string;
  assetId: string;
  assetName: string;
  enabled: boolean;
  bindings: AssetBindingForm[];
};

type DocumentForm = {
  documentId: string;
  documentName: string;
  description: string;
  version: string;
  assets: AssetEntryForm[];
};

const networkTypeLabels: Record<AssetNetworkType, string> = {
  internal: '内网',
  external: '外网',
};

const statusText: Record<string, string> = {
  succeeded: '成功',
  failed: '失败',
  pending: '等待',
};

function randomId(prefix: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createAssetVersion() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `assets-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function createBinding(index: number, assetId = 'asset'): AssetBindingForm {
  return {
    clientId: randomId('binding'),
    bindingId: `${assetId || 'asset'}-binding-${index}`,
    matchType: 'ip',
    matchValue: '',
    networkType: 'internal',
    priority: '100',
    enabled: true,
  };
}

function createAsset(index: number): AssetEntryForm {
  const assetId = `asset-${index}`;
  return {
    clientId: randomId('asset'),
    assetId,
    assetName: '',
    enabled: true,
    bindings: [createBinding(1, assetId)],
  };
}

function createDefaultDocumentForm(): DocumentForm {
  return {
    documentId: 'default-assets',
    documentName: '默认资产映射',
    description: '',
    version: createAssetVersion(),
    assets: [
      {
        clientId: randomId('asset'),
        assetId: 'web-prod-01',
        assetName: '生产 Web 服务器 01',
        enabled: true,
        bindings: [
          {
            clientId: randomId('binding'),
            bindingId: 'web-prod-01-ip',
            matchType: 'ip',
            matchValue: '10.0.0.10',
            networkType: 'internal',
            priority: '100',
            enabled: true,
          },
        ],
      },
    ],
  };
}

function formatTime(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function statusClass(status: string) {
  if (status === 'succeeded' || status === 'ok') return 'status-green';
  if (status === 'pending') return 'status-yellow';
  if (status === 'failed' || status === 'error') return 'status-red';
  return 'status-gray';
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { message?: string };
  if (!response.ok) {
    throw new Error(payload.message ?? `HTTP ${response.status}`);
  }
  return payload;
}

function stripInlineComment(value: string) {
  let quote: '"' | "'" | '' = '';
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && quote === '"') {
      escaped = true;
      continue;
    }
    if ((char === '"' || char === "'") && !quote) {
      quote = char;
      continue;
    }
    if (char === quote) {
      quote = '';
      continue;
    }
    if (char === '#' && !quote && (index === 0 || /\s/.test(value[index - 1]))) {
      return value.slice(0, index).trim();
    }
  }
  return value.trim();
}

function parseScalar(raw: string) {
  const value = stripInlineComment(raw);
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

function parseBool(raw: string, fallback: boolean) {
  const value = parseScalar(raw).trim().toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function parseKeyValue(line: string) {
  const separator = line.indexOf(':');
  if (separator < 0) return null;
  return {
    key: line.slice(0, separator).trim(),
    value: line.slice(separator + 1).trim(),
  };
}

function assignAssetValue(asset: AssetEntryForm, key: string, rawValue: string) {
  if (key === 'asset_id') asset.assetId = parseScalar(rawValue);
  if (key === 'asset_name') asset.assetName = parseScalar(rawValue);
  if (key === 'enabled') asset.enabled = parseBool(rawValue, true);
}

function assignBindingValue(binding: AssetBindingForm, key: string, rawValue: string) {
  const value = parseScalar(rawValue);
  if (key === 'binding_id') binding.bindingId = value;
  if (key === 'match_type' && (value === 'ip' || value === 'cidr')) binding.matchType = value;
  if (key === 'match_value') binding.matchValue = value;
  if (key === 'network_type' && (value === 'internal' || value === 'external')) binding.networkType = value;
  if (key === 'priority') binding.priority = value;
  if (key === 'enabled') binding.enabled = parseBool(rawValue, true);
}

function parseAssetYaml(yamlContent: string): Pick<DocumentForm, 'version' | 'assets'> {
  const lines = yamlContent.replace(/\r\n/g, '\n').split('\n');
  let version = '';
  let schemaVersion = 1;
  let inEntries = false;
  let inBindings = false;
  let currentAsset: AssetEntryForm | null = null;
  let currentBinding: AssetBindingForm | null = null;
  const assets: AssetEntryForm[] = [];

  for (const rawLine of lines) {
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    const line = rawLine.trim();

    if (indent === 0) {
      const pair = parseKeyValue(line);
      if (!pair) continue;
      if (pair.key === 'schema_version') {
        const parsed = Number(parseScalar(pair.value));
        if (Number.isInteger(parsed) && parsed > 0) schemaVersion = parsed;
      }
      if (pair.key === 'version') version = parseScalar(pair.value);
      if (pair.key === 'entries') inEntries = true;
      continue;
    }

    if (!inEntries) continue;

    if (indent === 2 && line.startsWith('- ')) {
      currentAsset = {
        clientId: randomId('asset'),
        assetId: '',
        assetName: '',
        enabled: true,
        bindings: [],
      };
      assets.push(currentAsset);
      currentBinding = null;
      inBindings = false;
      const pair = parseKeyValue(line.slice(2));
      if (pair) assignAssetValue(currentAsset, pair.key, pair.value);
      continue;
    }

    if (!currentAsset) continue;

    if (indent === 4) {
      const pair = parseKeyValue(line);
      if (!pair) continue;
      if (pair.key === 'bindings') {
        inBindings = true;
        currentBinding = null;
      } else {
        assignAssetValue(currentAsset, pair.key, pair.value);
      }
      continue;
    }

    if (inBindings && indent === 6 && line.startsWith('- ')) {
      currentBinding = {
        clientId: randomId('binding'),
        bindingId: '',
        matchType: 'ip',
        matchValue: '',
        networkType: 'internal',
        priority: '100',
        enabled: true,
      };
      currentAsset.bindings.push(currentBinding);
      const pair = parseKeyValue(line.slice(2));
      if (pair) assignBindingValue(currentBinding, pair.key, pair.value);
      continue;
    }

    if (currentBinding && indent === 8) {
      const pair = parseKeyValue(line);
      if (pair) assignBindingValue(currentBinding, pair.key, pair.value);
    }
  }

  if (schemaVersion < 1) throw new Error('schema_version 必须是正整数');
  if (!version) throw new Error('YAML 缺少 version');
  if (!assets.length) throw new Error('YAML 缺少 entries');
  return { version, assets };
}

function yamlString(value: string) {
  return JSON.stringify(value.trim());
}

function buildAssetYaml(form: DocumentForm) {
  const lines = [
    'schema_version: 1',
    `version: ${yamlString(form.version)}`,
    'entries:',
  ];

  for (const asset of form.assets) {
    lines.push(`  - asset_id: ${yamlString(asset.assetId)}`);
    lines.push(`    asset_name: ${yamlString(asset.assetName)}`);
    lines.push(`    enabled: ${asset.enabled ? 'true' : 'false'}`);
    lines.push('    bindings:');
    for (const binding of asset.bindings) {
      lines.push(`      - binding_id: ${yamlString(binding.bindingId)}`);
      lines.push(`        match_type: ${yamlString(binding.matchType)}`);
      lines.push(`        match_value: ${yamlString(binding.matchValue)}`);
      lines.push(`        network_type: ${yamlString(binding.networkType)}`);
      lines.push(`        priority: ${Number.parseInt(binding.priority, 10) || 0}`);
      lines.push(`        enabled: ${binding.enabled ? 'true' : 'false'}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function normalizeId(value: string) {
  return value.trim().toLowerCase();
}

function validateDocumentForm(form: DocumentForm) {
  const errors: string[] = [];
  const documentId = normalizeId(form.documentId);
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(documentId)) {
    errors.push('文档 ID 只能使用小写字母、数字、下划线或中划线，并且必须以字母或数字开头');
  }
  if (!form.documentName.trim()) errors.push('文档名称不能为空');
  if (!form.version.trim()) errors.push('版本不能为空');
  if (!form.assets.length) errors.push('至少需要一个资产');

  const assetIds = new Set<string>();
  const bindingIds = new Set<string>();
  form.assets.forEach((asset, assetIndex) => {
    const assetLabel = `资产 ${assetIndex + 1}`;
    const assetId = asset.assetId.trim();
    if (!assetId) errors.push(`${assetLabel} 缺少资产 ID`);
    if (!asset.assetName.trim()) errors.push(`${assetLabel} 缺少资产名称`);
    if (assetId) {
      if (assetIds.has(assetId)) errors.push(`资产 ID 重复：${assetId}`);
      assetIds.add(assetId);
    }
    if (!asset.bindings.length) errors.push(`${assetLabel} 至少需要一个 IP/CIDR 绑定`);

    asset.bindings.forEach((binding, bindingIndex) => {
      const bindingLabel = `${assetLabel} 的绑定 ${bindingIndex + 1}`;
      const bindingId = binding.bindingId.trim();
      const priority = Number(binding.priority);
      if (!bindingId) errors.push(`${bindingLabel} 缺少绑定 ID`);
      if (bindingId) {
        if (bindingIds.has(bindingId)) errors.push(`绑定 ID 重复：${bindingId}`);
        bindingIds.add(bindingId);
      }
      if (!binding.matchValue.trim()) errors.push(`${bindingLabel} 缺少 IP/CIDR`);
      if (binding.matchType === 'cidr' && !binding.matchValue.includes('/')) {
        errors.push(`${bindingLabel} 的 CIDR 需要包含掩码，例如 10.0.0.0/24`);
      }
      if (binding.matchType === 'ip' && binding.matchValue.includes('/')) {
        errors.push(`${bindingLabel} 是单 IP 类型，不能包含 CIDR 掩码`);
      }
      if (!binding.priority.trim()) errors.push(`${bindingLabel} 缺少优先级`);
      if (!Number.isInteger(priority)) errors.push(`${bindingLabel} 的优先级必须是整数`);
    });
  });

  if (errors.length) {
    throw new Error(errors.slice(0, 6).join('；'));
  }
}

function bindingIpList(asset: AssetEntryForm) {
  return asset.bindings.map((binding) => binding.matchValue.trim()).filter(Boolean);
}

function enabledBindingCount(asset: AssetEntryForm) {
  return asset.bindings.filter((binding) => binding.enabled).length;
}

export default function AssetsPage() {
  const [documents, setDocuments] = useState<AssetDocumentRecord[]>([]);
  const [publishLogs, setPublishLogs] = useState<AssetPublishLogRecord[]>([]);
  const [targets, setTargets] = useState<ProbeDispatcherTargetRecord[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState('');
  const [documentForm, setDocumentForm] = useState<DocumentForm>(() => createDefaultDocumentForm());
  const [expandedAssetIds, setExpandedAssetIds] = useState<string[]>([]);
  const [assetFilter, setAssetFilter] = useState('');
  const [publishLogsOpen, setPublishLogsOpen] = useState(false);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const selectedDocument = useMemo(
    () => documents.find((document) => document.documentId === selectedDocumentId) ?? null,
    [documents, selectedDocumentId],
  );
  const canEditAssets = permissions.includes('assets:edit');
  const canPublishAssets = permissions.includes('assets:publish');
  const enabledTargets = useMemo(() => targets.filter((target) => target.enabled), [targets]);
  const generatedYaml = useMemo(() => buildAssetYaml(documentForm), [documentForm]);
  const latestLogs = useMemo(() => publishLogs.slice(0, 20), [publishLogs]);
  const filteredAssetIndexes = useMemo(() => {
    const keyword = assetFilter.trim().toLowerCase();
    if (!keyword) return documentForm.assets.map((_, index) => index);
    return documentForm.assets
      .map((asset, index) => ({ asset, index }))
      .filter(({ asset }) => {
        const haystack = [
          asset.assetId,
          asset.assetName,
          ...asset.bindings.flatMap((binding) => [binding.bindingId, binding.matchValue, binding.networkType]),
        ].join(' ').toLowerCase();
        return haystack.includes(keyword);
      })
      .map(({ index }) => index);
  }, [assetFilter, documentForm.assets]);

  async function loadAll() {
    setLoading(true);
    setError('');
    try {
      const [sessionResult, documentsResult, targetsResult] = await Promise.allSettled([
        fetch('/api/auth/session', { cache: 'no-store' }).then((response) => readJson<SessionResponse>(response)),
        fetch('/api/dispatcher/assets/documents', { cache: 'no-store' }).then((response) => readJson<DispatcherDocumentsResponse>(response)),
        fetch('/api/dispatcher/targets', { cache: 'no-store' }).then((response) => readJson<DispatcherTargetsResponse>(response)),
      ]);

      if (documentsResult.status === 'rejected') throw documentsResult.reason;
      const nextDocuments = documentsResult.value.documents ?? [];
      const nextTargets = targetsResult.status === 'fulfilled' ? targetsResult.value.targets ?? [] : [];
      const sessionPayload = sessionResult.status === 'fulfilled' ? sessionResult.value : null;

      setPermissions(sessionPayload?.session?.permissions ?? []);
      setDocuments(nextDocuments);
      setPublishLogs(documentsResult.value.publishLogs ?? []);
      setTargets(nextTargets);
      setSelectedDocumentId((current) => (
        nextDocuments.some((document) => document.documentId === current)
          ? current
          : nextDocuments[0]?.documentId || ''
      ));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '资产管理数据加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    if (!selectedDocument) return;
    try {
      const parsed = parseAssetYaml(selectedDocument.yamlContent);
      setDocumentForm({
        documentId: selectedDocument.documentId,
        documentName: selectedDocument.documentName,
        description: selectedDocument.description ?? '',
        version: parsed.version || selectedDocument.assetVersion,
        assets: parsed.assets,
      });
      setExpandedAssetIds([]);
      setAssetFilter('');
    } catch (parseError) {
      setDocumentForm({
        documentId: selectedDocument.documentId,
        documentName: selectedDocument.documentName,
        description: selectedDocument.description ?? '',
        version: selectedDocument.assetVersion,
        assets: [],
      });
      setError(parseError instanceof Error ? `当前 YAML 无法转换成资产总览：${parseError.message}` : '当前 YAML 无法转换成资产总览');
    }
  }, [selectedDocument]);

  function resetDocumentForm() {
    setSelectedDocumentId('');
    setDocumentForm(createDefaultDocumentForm());
    setExpandedAssetIds([]);
    setAssetFilter('');
    setNotice('');
    setError('');
  }

  function updateDocumentField<K extends keyof DocumentForm>(key: K, value: DocumentForm[K]) {
    setDocumentForm((current) => ({ ...current, [key]: value }));
  }

  function updateAsset(assetIndex: number, patch: Partial<AssetEntryForm>) {
    setDocumentForm((current) => ({
      ...current,
      assets: current.assets.map((asset, index) => (index === assetIndex ? { ...asset, ...patch } : asset)),
    }));
  }

  function updateBinding(assetIndex: number, bindingIndex: number, patch: Partial<AssetBindingForm>) {
    setDocumentForm((current) => ({
      ...current,
      assets: current.assets.map((asset, index) => {
        if (index !== assetIndex) return asset;
        return {
          ...asset,
          bindings: asset.bindings.map((binding, currentBindingIndex) => (
            currentBindingIndex === bindingIndex ? { ...binding, ...patch } : binding
          )),
        };
      }),
    }));
  }

  function addAsset() {
    setDocumentForm((current) => {
      const nextAsset = createAsset(current.assets.length + 1);
      setExpandedAssetIds((ids) => [...ids, nextAsset.clientId]);
      return { ...current, assets: [...current.assets, nextAsset] };
    });
  }

  function removeAsset(assetIndex: number) {
    setDocumentForm((current) => ({
      ...current,
      assets: current.assets.filter((_, index) => index !== assetIndex),
    }));
  }

  function addBinding(assetIndex: number) {
    setDocumentForm((current) => ({
      ...current,
      assets: current.assets.map((asset, index) => (
        index === assetIndex
          ? { ...asset, bindings: [...asset.bindings, createBinding(asset.bindings.length + 1, asset.assetId)] }
          : asset
      )),
    }));
  }

  function removeBinding(assetIndex: number, bindingIndex: number) {
    setDocumentForm((current) => ({
      ...current,
      assets: current.assets.map((asset, index) => (
        index === assetIndex
          ? { ...asset, bindings: asset.bindings.filter((_, currentBindingIndex) => currentBindingIndex !== bindingIndex) }
          : asset
      )),
    }));
  }

  function toggleAsset(assetClientId: string) {
    setExpandedAssetIds((current) => (
      current.includes(assetClientId)
        ? current.filter((item) => item !== assetClientId)
        : [...current, assetClientId]
    ));
  }

  async function autoPublish(documentId: string) {
    if (!canPublishAssets) {
      return '已保存；当前账号没有自动发布权限。';
    }
    const probeIds = enabledTargets.map((target) => target.probeId);
    if (!probeIds.length) {
      return '已保存；未配置启用的探针目标，跳过自动发布。';
    }

    const payload = await fetch(`/api/dispatcher/assets/documents/${encodeURIComponent(documentId)}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        probeIds,
        validateOnly: false,
        reason: 'platform-auto-publish',
      }),
    }).then((response) => readJson<{ results: Array<{ ok?: boolean }> }>(response));
    const failed = payload.results.filter((item) => item.ok !== true).length;
    return `已保存并自动发布：成功 ${payload.results.length - failed}，失败 ${failed}`;
  }

  async function saveDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEditAssets) {
      setError('当前账号没有资产编辑权限');
      return;
    }
    setBusy('document');
    setNotice('');
    setError('');
    try {
      validateDocumentForm(documentForm);
      const normalizedDocumentId = normalizeId(documentForm.documentId);
      const endpoint = selectedDocumentId
        ? `/api/dispatcher/assets/documents/${encodeURIComponent(selectedDocumentId)}`
        : '/api/dispatcher/assets/documents';
      const payload = await fetch(endpoint, {
        method: selectedDocumentId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: normalizedDocumentId,
          documentName: documentForm.documentName,
          description: documentForm.description,
          yamlContent: generatedYaml,
        }),
      }).then((response) => readJson<{ document: AssetDocumentRecord }>(response));
      setSelectedDocumentId(payload.document.documentId);
      const publishMessage = await autoPublish(payload.document.documentId);
      setNotice(publishMessage);
      await loadAll();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '资产保存或自动发布失败');
    } finally {
      setBusy('');
    }
  }

  async function deleteDocument() {
    if (!selectedDocumentId) return;
    if (!canEditAssets) {
      setError('当前账号没有资产编辑权限');
      return;
    }
    setBusy('document-delete');
    setNotice('');
    setError('');
    try {
      await fetch(`/api/dispatcher/assets/documents/${encodeURIComponent(selectedDocumentId)}`, { method: 'DELETE' }).then((response) => readJson<{ ok: boolean }>(response));
      setNotice(`资产文档已删除：${selectedDocumentId}`);
      resetDocumentForm();
      await loadAll();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '资产文档删除失败');
    } finally {
      setBusy('');
    }
  }

  if (loading) {
    return <StatusPanel title="资产管理加载中" description="正在读取资产文档和发布记录。" />;
  }

  return (
    <section className="page asset-console-page">
      <header className="page-header asset-simple-header">
        <div>
          <h1 className="page-title">资产管理</h1>
          <p className="page-description">维护资产 ID、资产名称和 IP/CIDR 绑定；保存后自动发布到所有启用探针。</p>
        </div>
      </header>

      {error ? <div className="status-inline status-inline-error">{error}</div> : null}
      {notice ? <div className="status-inline status-inline-success">{notice}</div> : null}

      <SectionCard
        title="资产总览"
        description="点击资产名称展开详情并编辑绑定。探针目标请到设置中心维护。"
        actions={(
          <div className="toolbar-group">
            <button className="button" type="button" onClick={() => setPublishLogsOpen(true)}>发布记录</button>
            <button className="button" type="button" disabled={!canEditAssets} onClick={addAsset}>新增资产</button>
            <button className="button" type="button" disabled={Boolean(busy) || !canEditAssets || !selectedDocumentId} onClick={deleteDocument}>删除文档</button>
            <button className="button" type="button" disabled={!canEditAssets} onClick={resetDocumentForm}>新建文档</button>
          </div>
        )}
      >
        <form className="asset-overview-form" onSubmit={saveDocument}>
          <div className="asset-overview-toolbar">
            <label className="settings-field">
              <span className="field-section-title">当前文档</span>
              <select className="input" value={selectedDocumentId} onChange={(event) => setSelectedDocumentId(event.target.value)}>
                <option value="">新建文档</option>
                {documents.map((document) => (
                  <option key={document.documentId} value={document.documentId}>{document.documentName} / {document.assetVersion}</option>
                ))}
              </select>
            </label>
            <label className="settings-field">
              <span className="field-section-title">文档 ID</span>
              <input className="input" value={documentForm.documentId} onChange={(event) => updateDocumentField('documentId', event.target.value)} disabled={Boolean(selectedDocumentId) || !canEditAssets} />
            </label>
            <label className="settings-field">
              <span className="field-section-title">文档名称</span>
              <input className="input" value={documentForm.documentName} onChange={(event) => updateDocumentField('documentName', event.target.value)} disabled={!canEditAssets} />
            </label>
            <label className="settings-field">
              <span className="field-section-title">版本</span>
              <input className="input" value={documentForm.version} onChange={(event) => updateDocumentField('version', event.target.value)} disabled={!canEditAssets} />
            </label>
          </div>

          <div className="asset-overview-actions">
            <input className="input asset-filter-input" value={assetFilter} onChange={(event) => setAssetFilter(event.target.value)} placeholder="搜索资产 ID、资产名称或 IP" />
            <span className="muted">自动发布目标：{enabledTargets.length ? enabledTargets.map((target) => target.displayName || target.probeId).join('、') : '暂无启用探针'}</span>
            <button className="button button-primary" type="submit" disabled={Boolean(busy) || !canEditAssets}>
              {busy === 'document' ? '保存并发布中' : '保存并自动发布'}
            </button>
          </div>

          <div className="asset-overview-table-wrap">
            <table className="table asset-overview-table">
              <thead>
                <tr>
                  <th>资产 ID</th>
                  <th>资产名称</th>
                  <th>IP / CIDR</th>
                  <th>网络类型</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredAssetIndexes.length === 0 ? (
                  <tr>
                    <td colSpan={6}><div className="empty-hint">暂无资产或没有匹配搜索条件。</div></td>
                  </tr>
                ) : null}
                {filteredAssetIndexes.map((assetIndex) => {
                  const asset = documentForm.assets[assetIndex];
                  if (!asset) return null;
                  const expanded = expandedAssetIds.includes(asset.clientId);
                  const ips = bindingIpList(asset);
                  const networkTypes = Array.from(new Set(asset.bindings.map((binding) => binding.networkType)));
                  return (
                    <Fragment key={asset.clientId}>
                      <tr key={asset.clientId} className={asset.enabled ? '' : 'asset-row-disabled'}>
                        <td><code>{asset.assetId || '-'}</code></td>
                        <td>
                          <button className="asset-name-toggle" type="button" onClick={() => toggleAsset(asset.clientId)}>
                            {asset.assetName || '未命名资产'}
                          </button>
                        </td>
                        <td>
                          <div className="asset-ip-list">
                            {ips.length ? ips.map((ip) => <span className="asset-ip-pill" key={ip}>{ip}</span>) : <span className="muted">暂无 IP</span>}
                          </div>
                        </td>
                        <td>
                          <div className="asset-ip-list">
                            {networkTypes.map((type) => <span className={`asset-chip asset-chip-${type}`} key={type}>{networkTypeLabels[type]}</span>)}
                          </div>
                        </td>
                        <td>{asset.enabled ? `启用 ${enabledBindingCount(asset)}/${asset.bindings.length}` : '停用'}</td>
                        <td>
                          <button className="button" type="button" disabled={!canEditAssets} onClick={() => removeAsset(assetIndex)}>删除</button>
                        </td>
                      </tr>
                      {expanded ? (
                        <tr key={`${asset.clientId}-detail`}>
                          <td colSpan={6}>
                            <div className="asset-detail-panel">
                              <div className="field-grid two">
                                <label className="settings-field">
                                  <span className="field-section-title">资产 ID</span>
                                  <input className="input" value={asset.assetId} onChange={(event) => updateAsset(assetIndex, { assetId: event.target.value })} disabled={!canEditAssets} />
                                </label>
                                <label className="settings-field">
                                  <span className="field-section-title">资产名称</span>
                                  <input className="input" value={asset.assetName} onChange={(event) => updateAsset(assetIndex, { assetName: event.target.value })} disabled={!canEditAssets} />
                                </label>
                              </div>
                              <label className="asset-switch">
                                <input type="checkbox" checked={asset.enabled} disabled={!canEditAssets} onChange={(event) => updateAsset(assetIndex, { enabled: event.target.checked })} />
                                <span>启用资产</span>
                              </label>

                              <div className="asset-binding-head">
                                <strong>IP / CIDR 明细</strong>
                                <button className="button" type="button" disabled={!canEditAssets} onClick={() => addBinding(assetIndex)}>添加 IP</button>
                              </div>
                              <div className="asset-binding-list">
                                {asset.bindings.map((binding, bindingIndex) => (
                                  <div className={`asset-binding-row${binding.enabled ? '' : ' asset-binding-row-disabled'}`} key={binding.clientId}>
                                    <label className="settings-field">
                                      <span className="field-section-title">类型</span>
                                      <select className="input" value={binding.matchType} disabled={!canEditAssets} onChange={(event) => updateBinding(assetIndex, bindingIndex, { matchType: event.target.value as AssetMatchType })}>
                                        <option value="ip">单 IP</option>
                                        <option value="cidr">CIDR</option>
                                      </select>
                                    </label>
                                    <label className="settings-field">
                                      <span className="field-section-title">IP / CIDR</span>
                                      <input className="input" value={binding.matchValue} disabled={!canEditAssets} onChange={(event) => updateBinding(assetIndex, bindingIndex, { matchValue: event.target.value })} placeholder={binding.matchType === 'ip' ? '10.0.0.10' : '10.0.0.0/24'} />
                                    </label>
                                    <label className="settings-field">
                                      <span className="field-section-title">网络类型</span>
                                      <select className="input" value={binding.networkType} disabled={!canEditAssets} onChange={(event) => updateBinding(assetIndex, bindingIndex, { networkType: event.target.value as AssetNetworkType })}>
                                        <option value="internal">内网</option>
                                        <option value="external">外网</option>
                                      </select>
                                    </label>
                                    <label className="settings-field">
                                      <span className="field-section-title">优先级</span>
                                      <input className="input" type="number" value={binding.priority} disabled={!canEditAssets} onChange={(event) => updateBinding(assetIndex, bindingIndex, { priority: event.target.value })} />
                                    </label>
                                    <label className="asset-switch asset-binding-switch">
                                      <input type="checkbox" checked={binding.enabled} disabled={!canEditAssets} onChange={(event) => updateBinding(assetIndex, bindingIndex, { enabled: event.target.checked })} />
                                      <span>启用</span>
                                    </label>
                                    <button className="button" type="button" disabled={!canEditAssets} onClick={() => removeBinding(assetIndex, bindingIndex)}>删除</button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </form>
      </SectionCard>

      {publishLogsOpen ? (
        <div className="modal-backdrop" onClick={() => setPublishLogsOpen(false)} role="presentation">
          <div className="modal-window asset-publish-log-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <div>
                <div className="modal-title">资产发布记录</div>
                <div className="muted">最近 20 条自动发布或校验记录。</div>
              </div>
              <button className="button" type="button" onClick={() => setPublishLogsOpen(false)}>关闭</button>
            </div>
            {latestLogs.length === 0 ? (
              <div className="empty-hint">暂无发布记录。</div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>文档</th>
                      <th>Probe</th>
                      <th>状态</th>
                      <th>版本</th>
                      <th>错误</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latestLogs.map((log) => (
                      <tr key={log.publishId}>
                        <td>{formatTime(log.completedAt ?? log.createdAt)}</td>
                        <td>{log.documentId}</td>
                        <td>{log.probeId}</td>
                        <td><span className={`status-pill ${statusClass(log.status)}`}>{statusText[log.status] ?? log.status}</span></td>
                        <td>{log.appliedVersion ?? '-'}</td>
                        <td>{log.errorMessage ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}