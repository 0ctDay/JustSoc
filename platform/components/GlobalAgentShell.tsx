'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type InvestigationRecord = {
  taskId: string;
  alertId: string;
  alertIndex: string;
  alertTitle: string;
  status: string;
  runnerType: string;
  externalTaskId?: string;
  triggeredByUserKey?: string;
  requestJson: Record<string, unknown>;
  resultJson?: Record<string, unknown> | null;
  progressJson?: Record<string, unknown> | null;
  errorMessage?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type ChatMessage = {
  id: string;
  taskId: string;
  role: 'system' | 'user' | 'assistant';
  messageType: string;
  content: string;
  payload?: Record<string, unknown> | null;
  createdAt?: string;
};

type ShellState = {
  open: boolean;
  minimized: boolean;
  alertId: string;
  alertTitle: string;
  taskId: string;
};

type ConnectInfo = { wsUrl: string };

type SocketEvent =
  | { type: 'task_status'; status: string }
  | { type: 'progress'; progress: Record<string, unknown> }
  | { type: 'assistant_chunk'; chunk: string }
  | { type: 'assistant_message'; reply: string; details?: string }
  | { type: 'result'; result: Record<string, unknown> }
  | { type: 'error'; message: string };

const STORAGE_KEY = 'justsoc-agent-shell-state';

function loadShellState(): ShellState {
  if (typeof window === 'undefined') {
    return { open: false, minimized: false, alertId: '', alertTitle: '', taskId: '' };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { open: false, minimized: false, alertId: '', alertTitle: '', taskId: '' };
    }
    const parsed = JSON.parse(raw) as Partial<ShellState>;
    return {
      open: parsed.open === true,
      minimized: parsed.minimized === true,
      alertId: typeof parsed.alertId === 'string' ? parsed.alertId : '',
      alertTitle: typeof parsed.alertTitle === 'string' ? parsed.alertTitle : '',
      taskId: typeof parsed.taskId === 'string' ? parsed.taskId : '',
    };
  } catch {
    return { open: false, minimized: false, alertId: '', alertTitle: '', taskId: '' };
  }
}

function saveShellState(state: ShellState) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

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

function statusLabel(status?: string) {
  if (status === 'queued') return '排队中';
  if (status === 'running') return '调查中';
  if (status === 'completed') return '已完成';
  if (status === 'failed') return '失败';
  if (status === 'connected') return '已连接';
  return '未开始';
}

/* Simple animation hook for open/close transitions */
function useShellAnim(open: boolean) {
  const [visible, setVisible] = useState(open);
  const [anim, setAnim] = useState(open ? 'enter' : 'idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      }, 200);
    }
  }, [open, visible]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return { visible, animClass: anim === 'leaving' ? 'modal-window-anim-leave' : 'modal-window-anim-enter' };
}

export default function GlobalAgentShell() {
  const [shell, setShell] = useState<ShellState>({ open: false, minimized: false, alertId: '', alertTitle: '', taskId: '' });
  const [record, setRecord] = useState<InvestigationRecord | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const wsRef = useRef<WebSocket | null>(null);
  const streamBufferRef = useRef('');

  useEffect(() => {
    setShell(loadShellState());
  }, []);

  useEffect(() => {
    saveShellState(shell);
  }, [shell]);

  useEffect(() => {
    function onOpen(event: Event) {
      const custom = event as CustomEvent<{ alertId: string; alertTitle: string; taskId: string }>;
      const detail = custom.detail;
      if (!detail?.taskId) return;
      setShell({
        open: true,
        minimized: false,
        alertId: detail.alertId,
        alertTitle: detail.alertTitle,
        taskId: detail.taskId,
      });
      setError('');
      setDraft('');
    }
    window.addEventListener('justsoc-agent-shell-open', onOpen as EventListener);
    return () => window.removeEventListener('justsoc-agent-shell-open', onOpen as EventListener);
  }, []);

  async function refreshTask() {
    if (!shell.taskId) return;
    const [taskResponse, messagesResponse] = await Promise.all([
      fetchJson<{ investigation: InvestigationRecord | null }>(`/api/investigations/${shell.taskId}`),
      fetchJson<{ messages: ChatMessage[] }>(`/api/investigations/${shell.taskId}/messages`),
    ]);
    setRecord(taskResponse.investigation);
    setMessages(messagesResponse.messages);
    setError('');
  }

  useEffect(() => {
    if (!shell.taskId) return;
    let cancelled = false;

    async function load() {
      try {
        const [taskResponse, messagesResponse] = await Promise.all([
          fetchJson<{ investigation: InvestigationRecord | null }>(`/api/investigations/${shell.taskId}`),
          fetchJson<{ messages: ChatMessage[] }>(`/api/investigations/${shell.taskId}/messages`),
        ]);
        if (!cancelled) {
          setRecord(taskResponse.investigation);
          setMessages(messagesResponse.messages);
          setError('');
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : '调查状态加载失败');
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [shell.taskId]);

  useEffect(() => {
    if (!shell.taskId || !shell.open) return undefined;
    let cancelled = false;

    async function connect() {
      try {
        const response = await fetchJson<ConnectInfo>(`/api/investigations/${shell.taskId}/connect`);
        if (cancelled) return;
        const ws = new WebSocket(response.wsUrl);
        wsRef.current = ws;
        ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data) as SocketEvent;
            if (payload.type === 'assistant_chunk') {
              streamBufferRef.current += payload.chunk;
              setMessages((current) => {
                const next = [...current];
                const existingIndex = next.findIndex((item) => item.id === 'streaming-assistant');
                const nextMessage: ChatMessage = {
                  id: 'streaming-assistant',
                  taskId: shell.taskId,
                  role: 'assistant',
                  messageType: 'stream',
                  content: streamBufferRef.current,
                };
                if (existingIndex >= 0) {
                  next[existingIndex] = nextMessage;
                } else {
                  next.push(nextMessage);
                }
                return next;
              });
            }
            if (payload.type === 'assistant_message') {
              streamBufferRef.current = '';
              setMessages((current) => current.filter((item) => item.id !== 'streaming-assistant').concat({
                id: `assistant-${Date.now()}`,
                taskId: shell.taskId,
                role: 'assistant',
                messageType: 'chat',
                content: payload.reply,
                payload: payload.details ? { details: payload.details } : null,
              }));
            }
            if (payload.type === 'progress') {
              setRecord((current) => current ? { ...current, progressJson: payload.progress } : current);
            }
            if (payload.type === 'task_status') {
              setRecord((current) => current ? { ...current, status: payload.status } : current);
            }
            if (payload.type === 'result') {
              setRecord((current) => current ? { ...current, resultJson: payload.result, status: 'completed' } : current);
            }
            if (payload.type === 'error') {
              setError(payload.message);
            }
          } catch {
          }
        };
        ws.onerror = () => {
          setError('WebSocket 连接失败');
        };
      } catch (connectError) {
        setError(connectError instanceof Error ? connectError.message : 'WebSocket 初始化失败');
      }
    }

    void connect();
    return () => {
      cancelled = true;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [shell.taskId, shell.open]);

  async function sendMessage() {
    const content = draft.trim();
    if (!shell.taskId || !content || sending) return;
    try {
      setSending(true);
      setError('');
      setMessages((current) => current.concat({
        id: `user-${Date.now()}`,
        taskId: shell.taskId,
        role: 'user',
        messageType: 'chat',
        content,
      }));
      wsRef.current?.send(JSON.stringify({ type: 'user_message', content }));
      setDraft('');
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : '发送消息失败');
    } finally {
      setSending(false);
    }
  }

  const renderedMessages = useMemo(() => {
    const items = [...messages];
    if (items.length === 0 && shell.alertTitle) {
      items.push({
        id: 'bootstrap',
        taskId: shell.taskId,
        role: 'system',
        messageType: 'system',
        content: `已从事件发起调查：${shell.alertTitle}`,
      });
    }
    if (record?.errorMessage) {
      items.push({
        id: 'task-error',
        taskId: shell.taskId,
        role: 'assistant',
        messageType: 'error',
        content: record.errorMessage,
      });
    }
    if (error) {
      items.push({
        id: 'shell-error',
        taskId: shell.taskId,
        role: 'assistant',
        messageType: 'error',
        content: error,
      });
    }
    return items;
  }, [messages, shell.alertTitle, shell.taskId, record?.errorMessage, error]);

  const active = shell.open;
  const shellAnim = useShellAnim(shell.open && !shell.minimized);

  return (
    <>
      <button
        type="button"
        className={`agent-fab${active ? ' agent-fab-active' : ''}`}
        onClick={() => setShell((current) => ({ ...current, open: true, minimized: !current.open ? false : !current.minimized }))}
      >
        <span className="agent-fab-dot" />
        <span>Agent</span>
      </button>
      {shellAnim.visible ? (
        <section className={`agent-shell ${shellAnim.animClass}`}>
          <header className="agent-shell-header">
            <div>
              <div className="agent-shell-title">告警调查 Agent</div>
              <div className="muted">{shell.alertTitle || '等待从事件发起调查'}</div>
            </div>
            <div className="toolbar-group">
              <span className="status-pill status-gray">{statusLabel(record?.status)}</span>
              <button className="button" type="button" onClick={() => setShell((current) => ({ ...current, minimized: true }))}>最小化</button>
              <button className="button" type="button" onClick={() => setShell({ open: false, minimized: false, alertId: '', alertTitle: '', taskId: '' })}>关闭</button>
            </div>
          </header>
          <div className="agent-shell-body">
            {renderedMessages.length === 0 ? (
              <div className="empty-hint">从告警详情点击“Agent 调查”后，这里会显示任务进度、对话和调查结果。</div>
            ) : (
              renderedMessages.map((message) => (
                <article key={message.id} className={`agent-message agent-message-${message.role}`}>
                  <div className="agent-message-title">{message.role === 'user' ? '你' : message.messageType === 'stream' ? 'Claude Code 输出' : message.role === 'system' ? '系统' : 'Agent'}</div>
                  <pre className="code code-block agent-message-content">{message.content}</pre>
                </article>
              ))
            )}
            {record?.resultJson ? (
              <article className="agent-message agent-message-assistant">
                <div className="agent-message-title">调查结果</div>
                <pre className="code code-block agent-message-content">{JSON.stringify(record.resultJson, null, 2)}</pre>
              </article>
            ) : null}
          </div>
          <footer className="agent-shell-inputbar">
            <textarea
              className="textarea agent-shell-textarea"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="继续追问当前告警、补充调查方向，或要求 Agent 进一步关联分析..."
            />
            <button className="button button-primary" type="button" disabled={!shell.taskId || sending || !draft.trim()} onClick={() => void sendMessage()}>
              {sending ? '发送中...' : '发送'}
            </button>
          </footer>
        </section>
      ) : null}
    </>
  );
}
