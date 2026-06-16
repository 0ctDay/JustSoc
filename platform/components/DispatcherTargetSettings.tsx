'use client';

import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import SectionCard from '@/components/SectionCard';

type ProbeDispatcherTargetRecord = {
  probeId: string;
  displayName: string;
  baseUrl: string;
  authMode: 'bearer' | 'hmac';
  hmacKeyId?: string;
  hmacSecretConfigured: boolean;
  bearerTokenConfigured: boolean;
  enabled: boolean;
  updatedAt: string;
  lastSeenAt?: string;
};

type TargetForm = {
  probeId: string;
  displayName: string;
  baseUrl: string;
  authMode: 'hmac' | 'bearer';
  hmacKeyId: string;
  hmacSharedSecret: string;
  bearerToken: string;
  enabled: boolean;
};

const emptyTargetForm: TargetForm = {
  probeId: 'probe-prod',
  displayName: '生产探针',
  baseUrl: 'http://127.0.0.1:19091',
  authMode: 'hmac',
  hmacKeyId: 'probe-prod-dispatcher',
  hmacSharedSecret: '',
  bearerToken: '',
  enabled: true,
};

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { message?: string };
  if (!response.ok) {
    throw new Error(payload.message ?? `HTTP ${response.status}`);
  }
  return payload;
}

function formatTime(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

export default function DispatcherTargetSettings() {
  const [targets, setTargets] = useState<ProbeDispatcherTargetRecord[]>([]);
  const [targetForm, setTargetForm] = useState<TargetForm>(emptyTargetForm);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  async function loadTargets() {
    try {
      setLoading(true);
      setError('');
      const payload = await fetch('/api/dispatcher/targets', { cache: 'no-store' }).then((response) => readJson<{ targets?: ProbeDispatcherTargetRecord[] }>(response));
      setTargets(payload.targets ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载探针失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTargets();
  }, []);

  function openCreateModal() {
    setTargetForm(emptyTargetForm);
    setModalMode('create');
    setModalOpen(true);
    setMessage('');
    setError('');
  }

  function openEditModal(target: ProbeDispatcherTargetRecord) {
    setTargetForm({
      probeId: target.probeId,
      displayName: target.displayName,
      baseUrl: target.baseUrl,
      authMode: target.authMode,
      hmacKeyId: target.hmacKeyId ?? '',
      hmacSharedSecret: '',
      bearerToken: '',
      enabled: target.enabled,
    });
    setModalMode('edit');
    setModalOpen(true);
    setMessage('');
    setError('');
  }

  function closeModal() {
    if (busy) return;
    setModalOpen(false);
  }

  async function saveTarget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('target');
    setMessage('');
    setError('');
    try {
      const probeId = targetForm.probeId.trim().toLowerCase();
      const exists = modalMode === 'edit' || targets.some((target) => target.probeId === probeId);
      const body: Record<string, unknown> = {
        probeId,
        displayName: targetForm.displayName,
        baseUrl: targetForm.baseUrl,
        authMode: targetForm.authMode,
        enabled: targetForm.enabled,
      };
      if (targetForm.authMode === 'hmac') {
        body.hmacKeyId = targetForm.hmacKeyId;
        if (targetForm.hmacSharedSecret.trim()) body.hmacSharedSecret = targetForm.hmacSharedSecret;
      } else if (targetForm.bearerToken.trim()) {
        body.bearerToken = targetForm.bearerToken;
      }

      await fetch(exists ? `/api/dispatcher/targets/${encodeURIComponent(probeId)}` : '/api/dispatcher/targets', {
        method: exists ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((response) => readJson<{ target: ProbeDispatcherTargetRecord }>(response));
      setTargetForm(emptyTargetForm);
      setMessage(`探针已保存：${probeId}`);
      setModalOpen(false);
      await loadTargets();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存探针失败');
    } finally {
      setBusy('');
    }
  }

  async function deleteTarget(probeId: string) {
    setBusy(`delete-${probeId}`);
    setMessage('');
    setError('');
    try {
      await fetch(`/api/dispatcher/targets/${encodeURIComponent(probeId)}`, { method: 'DELETE' }).then((response) => readJson<{ ok: boolean }>(response));
      setMessage(`探针已删除：${probeId}`);
      await loadTargets();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除探针失败');
    } finally {
      setBusy('');
    }
  }

  async function fetchTargetStatus(probeId: string) {
    setBusy(`status-${probeId}`);
    setMessage('');
    setError('');
    try {
      const payload = await fetch(`/api/dispatcher/targets/${encodeURIComponent(probeId)}/status`, { cache: 'no-store' }).then((response) => readJson<{ result: { payload?: Record<string, unknown> } }>(response));
      const assets = payload.result.payload?.assets as Record<string, unknown> | undefined;
      const currentVersion = typeof assets?.currentVersion === 'string' ? assets.currentVersion : '未应用';
      setMessage(`${probeId} 当前资产版本：${currentVersion}`);
      await loadTargets();
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : '读取探针状态失败');
    } finally {
      setBusy('');
    }
  }

  return (
    <SectionCard
      title="探针配置"
      description="主页面只展示当前探针列表。新增和修改通过弹出窗口完成，总览页和资产下发都会读取这里的探针。"
      actions={<button className="button button-primary" type="button" disabled={Boolean(busy)} onClick={openCreateModal}>新增探针</button>}
    >
      {error ? <div className="status-inline status-inline-error">{error}</div> : null}
      {message ? <div className="status-inline status-inline-success">{message}</div> : null}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Probe</th>
              <th>地址</th>
              <th>认证</th>
              <th>最后可达</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5}>加载中...</td></tr>
            ) : null}
            {!loading && targets.length === 0 ? (
              <tr><td colSpan={5}><div className="empty-hint">暂无探针。</div></td></tr>
            ) : null}
            {targets.map((target) => (
              <tr key={target.probeId}>
                <td>{target.displayName}<br /><span className="muted">{target.probeId} / {target.enabled ? '启用' : '停用'}</span></td>
                <td>{target.baseUrl}</td>
                <td>{target.authMode} / {target.authMode === 'hmac' ? (target.hmacSecretConfigured ? '已配置' : '未配置') : (target.bearerTokenConfigured ? '已配置' : '未配置')}</td>
                <td>{formatTime(target.lastSeenAt)}</td>
                <td>
                  <div className="toolbar-group">
                    <button className="button" type="button" disabled={Boolean(busy)} onClick={() => openEditModal(target)}>编辑</button>
                    <button className="button" type="button" disabled={Boolean(busy)} onClick={() => fetchTargetStatus(target.probeId)}>{busy === `status-${target.probeId}` ? '读取中' : '状态'}</button>
                    <button className="button" type="button" disabled={Boolean(busy)} onClick={() => deleteTarget(target.probeId)}>删除</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalOpen && mounted ? createPortal(
        <div className="modal-backdrop" onClick={closeModal} role="presentation">
          <div className="modal-window settings-mapping-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <div>
                <div className="modal-title">{modalMode === 'edit' ? '编辑探针' : '新增探针'}</div>
                <div className="muted">保存后会立即更新探针列表，总览页面和资产下发都会使用这里的探针。</div>
              </div>
              <div className="toolbar-group">
                <button className="button" type="button" disabled={Boolean(busy)} onClick={closeModal}>关闭</button>
              </div>
            </div>

            <form className="settings-form" onSubmit={saveTarget}>
              <div className="field-grid two">
                <label className="settings-field">
                  <span className="field-section-title">Probe ID</span>
                  <input className="input" value={targetForm.probeId} onChange={(event) => setTargetForm((current) => ({ ...current, probeId: event.target.value }))} disabled={modalMode === 'edit'} />
                </label>
                <label className="settings-field">
                  <span className="field-section-title">显示名称</span>
                  <input className="input" value={targetForm.displayName} onChange={(event) => setTargetForm((current) => ({ ...current, displayName: event.target.value }))} />
                </label>
              </div>
              <label className="settings-field">
                <span className="field-section-title">Base URL</span>
                <input className="input" value={targetForm.baseUrl} onChange={(event) => setTargetForm((current) => ({ ...current, baseUrl: event.target.value }))} />
              </label>
              <div className="field-grid two">
                <label className="settings-field">
                  <span className="field-section-title">认证模式</span>
                  <select className="input" value={targetForm.authMode} onChange={(event) => setTargetForm((current) => ({ ...current, authMode: event.target.value as TargetForm['authMode'] }))}>
                    <option value="hmac">HMAC</option>
                    <option value="bearer">Bearer</option>
                  </select>
                </label>
                <label className="check-card asset-enabled-check">
                  <input type="checkbox" checked={targetForm.enabled} onChange={(event) => setTargetForm((current) => ({ ...current, enabled: event.target.checked }))} />
                  <span>启用自动发布</span>
                </label>
              </div>
              {targetForm.authMode === 'hmac' ? (
                <div className="field-grid two">
                  <label className="settings-field">
                    <span className="field-section-title">HMAC Key ID</span>
                    <input className="input" value={targetForm.hmacKeyId} onChange={(event) => setTargetForm((current) => ({ ...current, hmacKeyId: event.target.value }))} />
                  </label>
                  <label className="settings-field">
                    <span className="field-section-title">共享密钥</span>
                    <input className="input" type="password" value={targetForm.hmacSharedSecret} onChange={(event) => setTargetForm((current) => ({ ...current, hmacSharedSecret: event.target.value }))} placeholder="更新时留空表示沿用旧值" />
                  </label>
                </div>
              ) : (
                <label className="settings-field">
                  <span className="field-section-title">Bearer Token</span>
                  <input className="input" type="password" value={targetForm.bearerToken} onChange={(event) => setTargetForm((current) => ({ ...current, bearerToken: event.target.value }))} placeholder="更新时留空表示沿用旧值" />
                </label>
              )}

              <div className="settings-mapping-modal-footer">
                <span className="muted">保存后会同步刷新探针列表。</span>
                <div className="toolbar-group">
                  <button className="button" type="button" disabled={Boolean(busy)} onClick={closeModal}>取消</button>
                  <button className="button button-primary" type="submit" disabled={Boolean(busy)}>{busy === 'target' ? '保存中' : '保存探针'}</button>
                </div>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      ) : null}
    </SectionCard>
  );
}
