'use client';

import { useEffect, useRef, useState } from 'react';

import FieldValuesPanel from '@/components/FieldValuesPanel';
import HttpPreview from '@/components/HttpPreview';
import JsonPreview from '@/components/JsonPreview';
import SectionCard from '@/components/SectionCard';
import StatusPanel from '@/components/StatusPanel';
import { useClickCenteredModalPosition } from '@/lib/detail-modal-position';
import type { AlertFieldDefinition } from '@/lib/alert-fields';

export type AlertDetailModalAiAnalysisResult = {
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

export type AlertDetailModalDetail = {
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

type DetailTab = 'http' | 'fields' | 'ai' | 'json';

type Props = {
  open: boolean;
  detail: AlertDetailModalDetail | null;
  detailError: string;
  loadingDetail: boolean;
  detailTab: DetailTab;
  setDetailTab: (tab: DetailTab) => void;
  aiResult: AlertDetailModalAiAnalysisResult | null;
  aiError: string;
  loadingAi: boolean;
  onRunAiAnalysis: () => void;
  onClose: () => void;
  canOpenPreviousAlert?: boolean;
  canOpenNextAlert?: boolean;
  onOpenPreviousAlert?: () => void;
  onOpenNextAlert?: () => void;
  canToggleRead?: boolean;
  toggleReadLabel?: string;
  onToggleRead?: () => void;
  fields: AlertFieldDefinition[];
  modalStyle?: React.CSSProperties;
  anchorY?: number | null;
  resizeHandle?: React.ReactNode;
};

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="probe-metric-item">
      <span className="probe-metric-label">{label}</span>
      <strong className="probe-metric-value">{value || '暂无'}</strong>
    </div>
  );
}

export default function AlertDetailModal({
  open,
  detail,
  detailError,
  loadingDetail,
  detailTab,
  setDetailTab,
  aiResult,
  aiError,
  loadingAi,
  onRunAiAnalysis,
  onClose,
  canOpenPreviousAlert,
  canOpenNextAlert,
  onOpenPreviousAlert,
  onOpenNextAlert,
  canToggleRead,
  toggleReadLabel,
  onToggleRead,
  fields,
  modalStyle,
  anchorY,
  resizeHandle,
}: Props) {
  const [visible, setVisible] = useState(open);
  const [anim, setAnim] = useState<'enter' | 'leaving' | 'idle'>(open ? 'enter' : 'idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (open) {
      setVisible(true);
      setAnim('enter');
      return;
    }

    if (visible) {
      setAnim('leaving');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setVisible(false);
        setAnim('idle');
        onCloseRef.current();
      }, 200);
    }
  }, [open, visible]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const positionedModal = useClickCenteredModalPosition(visible, anchorY ?? null, modalStyle, 'shared-alert-detail');

  if (!visible) return null;

  const backdropCls = anim === 'leaving' ? 'modal-backdrop-anim-leave' : 'modal-backdrop-anim-enter';
  const windowCls = anim === 'leaving' ? 'modal-window-anim-leave' : 'modal-window-anim-enter';

  return (
    <div className={`modal-backdrop modal-backdrop-page ${backdropCls}`} onClick={onClose} role="presentation">
      <div
        ref={positionedModal.modalRef}
        className={`modal-window ${windowCls} alert-detail-modal`}
        style={positionedModal.modalStyle}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-header">
          <div>
            <div className="modal-title">{detail?.title ?? '告警详情'}</div>
            <div className="toolbar-group">
              {detail?.engine?.attack_stage ? (
                <span className={`status-pill ${detail.engine.attack_stage === 'confirmed_success' ? 'status-red' : detail.engine.attack_stage === 'probable_success' ? 'status-yellow' : 'status-gray'}`}>
                  {detail.engine.attack_stage}
                </span>
              ) : null}
              {typeof detail?.engine?.attack_success === 'boolean' ? (
                <span className={`status-pill ${detail.engine.attack_success ? 'status-red' : 'status-gray'}`}>
                  {detail.engine.attack_success ? '攻击成功' : '攻击未成功'}
                </span>
              ) : null}
              {detail?.engine?.attack_success_confidence ? (
                <span className={`status-pill ${detail.engine.attack_success_confidence === 'high' ? 'status-red' : detail.engine.attack_success_confidence === 'medium' ? 'status-yellow' : 'status-gray'}`}>
                  {detail.engine.attack_success_confidence}
                </span>
              ) : null}
            </div>
            <div className="muted">点击遮罩或按 Esc 可关闭窗口</div>
          </div>
          <div className="toolbar-group">
            {onOpenPreviousAlert ? <button className="button" type="button" disabled={!canOpenPreviousAlert} onClick={onOpenPreviousAlert}>上一条</button> : null}
            {onOpenNextAlert ? <button className="button" type="button" disabled={!canOpenNextAlert} onClick={onOpenNextAlert}>下一条</button> : null}
            {onToggleRead && canToggleRead ? <button className="button" type="button" onClick={onToggleRead}>{toggleReadLabel ?? '标记已读'}</button> : null}
            <button className="button button-primary" type="button" disabled={loadingAi} onClick={onRunAiAnalysis}>{loadingAi ? 'AI 研判中...' : 'AI研判'}</button>
            <button className="button" type="button" onClick={onClose}>关闭</button>
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
              <button className={`modal-tab ${detailTab === 'fields' ? 'modal-tab-active' : ''}`} type="button" onClick={() => setDetailTab('fields')}>字段面板</button>
              <button className={`modal-tab ${detailTab === 'ai' ? 'modal-tab-active' : ''}`} type="button" onClick={() => setDetailTab('ai')}>AI 研判</button>
              <button className={`modal-tab ${detailTab === 'json' ? 'modal-tab-active' : ''}`} type="button" onClick={() => setDetailTab('json')}>原始日志</button>
            </div>

            {detailTab === 'http' ? (
              <div className="tab-content-enter">
                  <HttpPreview request={detail?.http?.request} response={detail?.http?.response} />
              </div>
            ) : null}

            {detailTab === 'fields' ? (
              <div className="tab-content-enter">
                <SectionCard title="字段面板" description="展示字段面板中定义的所有字段及其在当前告警中的值。">
                  <FieldValuesPanel document={detail?.document} fields={fields} />
                </SectionCard>
              </div>
            ) : null}

            {detailTab === 'json' ? (
              <div className="tab-content-enter">
                <SectionCard title="原始日志（JSON）" description="保留完整 _source，便于继续排障与字段确认。">
                  <JsonPreview value={detail?.document} emptyText="当前告警没有原始日志内容。" />
                </SectionCard>
              </div>
            ) : null}

            {detailTab === 'ai' ? (
              <div className="tab-content-enter">
                <SectionCard title="AI 研判结果" description="基于告警、请求、响应、规则与 engine 辅助字段生成。">
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
                          <Metric label="风险等级" value={aiResult.judgement.risk_level} />
                          <Metric label="置信度" value={aiResult.judgement.confidence} />
                          <Metric label="是否疑似真实攻击" value={aiResult.judgement.is_likely_true_positive ? '是' : '否'} />
                          <Metric label="是否疑似攻击成功" value={aiResult.judgement.is_likely_successful_attack ? '是' : '否'} />
                        </div>
                      </SectionCard>
                      <SectionCard title="关键证据">
                        {aiResult.evidence.length ? <ul className="list">{aiResult.evidence.map((item) => <li key={item}>{item}</li>)}</ul> : <div className="empty-hint">暂无证据摘要。</div>}
                      </SectionCard>
                      <SectionCard title="分析说明">
                        <div className="probe-metric-grid">
                          <Metric label="攻击意图" value={aiResult.analysis.attack_intent} />
                          <Metric label="成功性判断" value={aiResult.analysis.success_assessment} />
                          <Metric label="影响范围提示" value={aiResult.analysis.scope_hint} />
                          <Metric label="规则一致性" value={aiResult.analysis.rule_consistency} />
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
              </div>
            ) : null}
          </div>
        )}
        {resizeHandle}
      </div>
    </div>
  );
}
