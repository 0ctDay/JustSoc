'use client';

import type { CSSProperties, FormEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import ControlledMarkdown from '@/components/ControlledMarkdown';
import type { ClaudeBridgePendingRequest, ClaudeBridgeTaskEvent, ClaudeBridgeTaskLogEntry, ClaudeBridgeTaskSnapshot } from '@/lib/claude-code-bridge-config';

const CURRENT_TASK_KEY = 'justsoc-claude-bridge-current-task-id';
const WINDOW_SIZE_KEY = 'justsoc-embedded-chat-window-size';
const MIN_WINDOW_WIDTH = 320;
const MIN_WINDOW_HEIGHT = 360;
const DESKTOP_RIGHT_GAP = 24;
const DESKTOP_BOTTOM_GAP = 100;
const MOBILE_RIGHT_GAP = 12;
const MOBILE_BOTTOM_GAP = 88;

type WindowSize = {
  width: number;
  height: number;
};

type PendingQuestionOption = {
  label: string;
  description?: string;
};

type PendingQuestion = {
  id: string;
  prompt: string;
  multiSelect: boolean;
  options: PendingQuestionOption[];
};

type TaskExchange = {
  key: string;
  userEntry: ClaudeBridgeTaskLogEntry;
  assistantText: string;
  processEntries: ClaudeBridgeTaskLogEntry[];
  tone: 'success' | 'error' | 'neutral' | 'pending';
  pendingRequest?: ClaudeBridgePendingRequest;
  partialText?: string;
};

type BridgeCreateTaskEventDetail = {
  title?: string;
  prompt: string;
};

type BridgeOpenTaskEventDetail = {
  taskId: string;
};

function persistCurrentTaskId(taskId: string | null) {
  if (taskId) {
    window.localStorage.setItem(CURRENT_TASK_KEY, taskId);
  } else {
    window.localStorage.removeItem(CURRENT_TASK_KEY);
  }
}

function getStoredCurrentTaskId() {
  return window.localStorage.getItem(CURRENT_TASK_KEY);
}

function getWindowInsets() {
  if (typeof window === 'undefined') {
    return { right: DESKTOP_RIGHT_GAP, bottom: DESKTOP_BOTTOM_GAP };
  }

  if (window.innerWidth <= 900) {
    return { right: MOBILE_RIGHT_GAP, bottom: MOBILE_BOTTOM_GAP };
  }

  return { right: DESKTOP_RIGHT_GAP, bottom: DESKTOP_BOTTOM_GAP };
}

function getMaxWidth() {
  if (typeof window === 'undefined') {
    return 420;
  }

  return Math.max(MIN_WINDOW_WIDTH, window.innerWidth - getWindowInsets().right);
}

function getMaxHeight() {
  if (typeof window === 'undefined') {
    return 560;
  }

  return Math.max(MIN_WINDOW_HEIGHT, window.innerHeight - getWindowInsets().bottom - 28);
}

function clampSize(width: number, height: number): WindowSize {
  return {
    width: Math.max(MIN_WINDOW_WIDTH, Math.min(width, getMaxWidth())),
    height: Math.max(MIN_WINDOW_HEIGHT, Math.min(height, getMaxHeight())),
  };
}

function loadWindowSize(): WindowSize {
  if (typeof window === 'undefined') {
    return { width: 420, height: 560 };
  }

  try {
    const raw = window.localStorage.getItem(WINDOW_SIZE_KEY);
    if (!raw) {
      return { width: 420, height: 560 };
    }

    const parsed = JSON.parse(raw) as Partial<WindowSize>;
    return clampSize(
      typeof parsed.width === 'number' ? parsed.width : 420,
      typeof parsed.height === 'number' ? parsed.height : 560,
    );
  } catch {
    return { width: 420, height: 560 };
  }
}

function formatSessionTime(value: string) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function extractQuestionList(pendingRequest: ClaudeBridgePendingRequest | undefined): PendingQuestion[] {
  const questions = pendingRequest?.mode === 'question' && Array.isArray(pendingRequest.input.questions)
    ? pendingRequest.input.questions
    : [];

  return questions.map((question, index) => {
    const record = question && typeof question === 'object' ? question as Record<string, unknown> : {};
    const options = Array.isArray(record.options)
      ? record.options.map((option) => {
          const optionRecord = option && typeof option === 'object' ? option as Record<string, unknown> : {};
          return {
            label: typeof optionRecord.label === 'string' ? optionRecord.label : `option_${index + 1}`,
            description: typeof optionRecord.description === 'string' ? optionRecord.description : undefined,
          };
        })
      : [];

    return {
      id:
        typeof record.question === 'string' && record.question.trim()
          ? record.question
          : typeof record.id === 'string' && record.id.trim()
            ? record.id
            : `question_${index + 1}`,
      prompt:
        typeof record.question === 'string' && record.question.trim()
          ? record.question
          : typeof record.id === 'string' && record.id.trim()
            ? record.id
            : `question_${index + 1}`,
      multiSelect: record.multiSelect === true,
      options,
    };
  });
}

function normalizeTaskList(tasks: ClaudeBridgeTaskSnapshot[] | undefined) {
  return [...(tasks ?? [])].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function fetchEntryText(entry: ClaudeBridgeTaskLogEntry) {
  return entry.text || (entry.payload ? JSON.stringify(entry.payload, null, 2) : '(empty)');
}

const AGGREGATION_AGENT_PROMPT_PREFIX = '你是一个面向 SOC / 告警平台的聚合级攻击调查 Agent';

function getDisplayUserText(entry: ClaudeBridgeTaskLogEntry) {
  const text = fetchEntryText(entry);
  if (text.startsWith(AGGREGATION_AGENT_PROMPT_PREFIX)) {
    return '正在请求 Agent 分析…';
  }
  return text;
}

function taskStatusTone(status: ClaudeBridgeTaskSnapshot['status'] | 'draft') {
  if (status === 'running') return 'status-yellow';
  if (status === 'waiting_input') return 'status-red';
  if (status === 'completed') return 'status-green';
  if (status === 'error' || status === 'interrupted') return 'status-red';
  return 'status-gray';
}

function mapProcessLogClass(entry: ClaudeBridgeTaskLogEntry) {
  if (entry.kind === 'error') return 'justsoc-chat-process-entry-error';
  if (entry.kind === 'tool_progress' || entry.kind === 'task_progress') return 'justsoc-chat-process-entry-progress';
  return 'justsoc-chat-process-entry-neutral';
}

function buildTaskExchanges(task: ClaudeBridgeTaskSnapshot | null, partialAssistantText: string): TaskExchange[] {
  if (!task) {
    return [];
  }

  const activeTask = task;
  const exchanges: TaskExchange[] = [];
  let current:
    | {
        userEntry: ClaudeBridgeTaskLogEntry;
        processEntries: ClaudeBridgeTaskLogEntry[];
        assistantMessages: ClaudeBridgeTaskLogEntry[];
        resultEntry?: ClaudeBridgeTaskLogEntry;
        errorEntry?: ClaudeBridgeTaskLogEntry;
        permissionEntries: ClaudeBridgeTaskLogEntry[];
      }
    | null = null;

  function finalizeCurrent(isLast: boolean) {
    if (!current) {
      return;
    }

    const latestAssistant = current.assistantMessages[current.assistantMessages.length - 1];
    const assistantText =
      current.resultEntry?.text?.trim()
      || current.errorEntry?.text?.trim()
      || latestAssistant?.text?.trim()
      || (isLast && partialAssistantText.trim())
      || (activeTask.pendingRequest && isLast ? '处理中，等待继续执行或权限响应。' : '')
      || (isLast && activeTask.status === 'running' ? '处理中...' : '');

    const assistantMessageRemainders = latestAssistant
      ? current.assistantMessages.filter((entry) => entry.id !== latestAssistant.id)
      : current.assistantMessages;

    const processEntries = [
      ...current.permissionEntries,
      ...current.processEntries,
      ...assistantMessageRemainders,
    ];

    exchanges.push({
      key: current.userEntry.id,
      userEntry: current.userEntry,
      assistantText,
      processEntries,
      tone: current.errorEntry
        ? 'error'
        : activeTask.pendingRequest && isLast
          ? 'pending'
          : current.resultEntry
            ? (activeTask.status === 'completed' ? 'success' : 'neutral')
            : assistantText
              ? 'neutral'
              : 'pending',
      pendingRequest: activeTask.pendingRequest && isLast ? activeTask.pendingRequest : undefined,
      partialText: isLast && partialAssistantText.trim() ? partialAssistantText : undefined,
    });
  }

  for (const entry of task.logs) {
    if (entry.kind === 'user_message') {
      finalizeCurrent(false);
      current = {
        userEntry: entry,
        processEntries: [],
        assistantMessages: [],
        permissionEntries: [],
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (entry.kind === 'assistant_message') {
      current.assistantMessages.push(entry);
      continue;
    }
    if (entry.kind === 'task_result') {
      current.resultEntry = entry;
      continue;
    }
    if (entry.kind === 'error') {
      current.errorEntry = entry;
      continue;
    }
    if (entry.kind === 'permission_request') {
      current.permissionEntries.push(entry);
      continue;
    }

    current.processEntries.push(entry);
  }

  finalizeCurrent(true);
  return exchanges;
}

async function fetchJson<T>(input: string, init?: RequestInit) {
  const response = await fetch(input, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message ?? 'Request failed');
  }
  return payload as T;
}

export default function GitHubEmbeddedChat() {
  const chatBodyRef = useRef<HTMLDivElement | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const bodyInteractionRef = useRef(false);
  const pendingAutoScrollRef = useRef(false);
  const previousRenderedCountRef = useRef(0);
  const resizeStateRef = useRef<{
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingTask, setLoadingTask] = useState(false);
  const [tasks, setTasks] = useState<ClaudeBridgeTaskSnapshot[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [currentTask, setCurrentTask] = useState<ClaudeBridgeTaskSnapshot | null>(null);
  const [partialAssistantText, setPartialAssistantText] = useState('');
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false);
  const [expandedProcessByExchange, setExpandedProcessByExchange] = useState<Record<string, boolean>>({});
  const [windowSize, setWindowSize] = useState<WindowSize>({ width: 420, height: 560 });
  const [windowReady, setWindowReady] = useState(false);
  const [decisionMessage, setDecisionMessage] = useState('');
  const [updatedInputJson, setUpdatedInputJson] = useState('');
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string | string[]>>({});

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    setWindowSize(loadWindowSize());
    setActiveTaskId(getStoredCurrentTaskId());
    setWindowReady(true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(WINDOW_SIZE_KEY, JSON.stringify(windowSize));
  }, [windowSize]);

  function closeEventStream() {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }

  function scrollToLatest(behavior: ScrollBehavior) {
    const body = chatBodyRef.current;
    if (!body) {
      return;
    }

    window.requestAnimationFrame(() => {
      body.scrollTo({
        top: body.scrollHeight,
        behavior,
      });
    });
  }

  function upsertTask(task: ClaudeBridgeTaskSnapshot) {
    setTasks((current) => {
      const next = [...current];
      const index = next.findIndex((item) => item.id === task.id);
      if (index >= 0) {
        next[index] = task;
      } else {
        next.unshift(task);
      }
      return normalizeTaskList(next);
    });
  }

  async function loadTaskList() {
    const payload = await fetchJson<{ tasks: ClaudeBridgeTaskSnapshot[] }>('/api/claude-bridge/tasks');
    const nextTasks = normalizeTaskList(payload.tasks);
    setTasks(nextTasks);
    return nextTasks;
  }

  async function loadTask(taskId: string) {
    setLoadingTask(true);
    try {
      const payload = await fetchJson<{ task: ClaudeBridgeTaskSnapshot }>(`/api/claude-bridge/tasks/${encodeURIComponent(taskId)}`);
      setCurrentTask(payload.task);
      setPartialAssistantText('');
      upsertTask(payload.task);
    } finally {
      setLoadingTask(false);
    }
  }

  function connectTaskStream(taskId: string) {
    closeEventStream();
    setPartialAssistantText('');
    const eventSource = new EventSource(`/api/claude-bridge/tasks/${encodeURIComponent(taskId)}/events`);

    eventSource.onmessage = (event) => {
      const payload = JSON.parse(event.data) as ClaudeBridgeTaskEvent;

      if (payload.type === 'snapshot' || payload.type === 'task.updated') {
        upsertTask(payload.task);
        if (payload.task.id === taskId) {
          setCurrentTask(payload.task);
          if (payload.task.status !== 'running') {
            setPartialAssistantText('');
          }
        }
        return;
      }

      if (payload.type === 'assistant.partial' && payload.taskId === taskId) {
        setPartialAssistantText((current) => current + payload.chunk);
        return;
      }

      if (payload.type === 'log' && payload.taskId === taskId) {
        setCurrentTask((current) => {
          if (!current || current.id !== taskId) {
            return current;
          }

          if (current.logs.some((entry) => entry.id === payload.entry.id)) {
            return current;
          }

          const nextTask = {
            ...current,
            logs: current.logs.concat(payload.entry),
            updatedAt: payload.entry.createdAt || current.updatedAt,
          };
          upsertTask(nextTask);
          return nextTask;
        });

        if (payload.entry.kind === 'assistant_message' || payload.entry.kind === 'task_result' || payload.entry.kind === 'error') {
          setPartialAssistantText('');
        }
        return;
      }

      if (payload.type === 'error' && payload.taskId === taskId) {
        setCurrentTask((current) => current ? {
          ...current,
          lastError: payload.message,
        } : current);
      }
    };

    eventSourceRef.current = eventSource;
  }

  useEffect(() => {
    if (!open || !windowReady) {
      return;
    }

    let cancelled = false;

    async function initialize() {
      const nextTasks = await loadTaskList();
      if (cancelled) return;

      if (activeTaskId && nextTasks.some((task) => task.id === activeTaskId)) {
        await loadTask(activeTaskId);
        if (!cancelled) {
          connectTaskStream(activeTaskId);
        }
      } else {
        setCurrentTask(null);
        setPartialAssistantText('');
      }
    }

    void initialize();
    return () => {
      cancelled = true;
    };
  }, [open, windowReady]);

  useEffect(() => {
    if (!open || typeof window === 'undefined') {
      return undefined;
    }

    function handleMouseMove(event: MouseEvent) {
      const resizeState = resizeStateRef.current;
      if (!resizeState) {
        return;
      }

      const deltaX = event.clientX - resizeState.startX;
      const deltaY = event.clientY - resizeState.startY;
      setWindowSize(
        clampSize(
          resizeState.startWidth - deltaX,
          resizeState.startHeight - deltaY,
        ),
      );
    }

    function handleMouseUp() {
      const hadInteraction = Boolean(resizeStateRef.current) || bodyInteractionRef.current;
      resizeStateRef.current = null;
      bodyInteractionRef.current = false;
      document.body.style.userSelect = '';

      if (hadInteraction && pendingAutoScrollRef.current) {
        pendingAutoScrollRef.current = false;
        scrollToLatest('smooth');
      }
    }

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [open]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    function handleResize() {
      setWindowSize((current) => clampSize(current.width, current.height));
    }

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const exchanges = useMemo(() => buildTaskExchanges(currentTask, partialAssistantText), [currentTask, partialAssistantText]);

  useEffect(() => {
    if (!open) {
      previousRenderedCountRef.current = exchanges.length;
      return;
    }

    const previousCount = previousRenderedCountRef.current;
    previousRenderedCountRef.current = exchanges.length;

    if (resizeStateRef.current || bodyInteractionRef.current) {
      pendingAutoScrollRef.current = true;
      return;
    }

    pendingAutoScrollRef.current = false;
    scrollToLatest(previousCount > 0 && exchanges.length > previousCount ? 'smooth' : 'auto');
  }, [exchanges, open]);

  useEffect(() => {
    setDecisionMessage('');
    setUpdatedInputJson('');
    setQuestionAnswers({});
  }, [currentTask?.pendingRequest?.requestId]);

  useEffect(() => {
    setExpandedProcessByExchange({});
  }, [activeTaskId]);

  useEffect(() => () => closeEventStream(), []);

  useEffect(() => {
    function handleCreateTaskEvent(event: Event) {
      const customEvent = event as CustomEvent<BridgeCreateTaskEventDetail>;
      const detail = customEvent.detail;
      if (!detail?.prompt?.trim()) {
        return;
      }

      setOpen(true);
      void createTaskFromPrompt(detail.prompt.trim(), detail.title?.trim() || undefined);
    }

    function handleOpenTaskEvent(event: Event) {
      const customEvent = event as CustomEvent<BridgeOpenTaskEventDetail>;
      const taskId = customEvent.detail?.taskId?.trim();
      if (!taskId) return;
      setOpen(true);
      void selectTask(taskId);
    }

    window.addEventListener('justsoc-claude-bridge-create-task', handleCreateTaskEvent as EventListener);
    window.addEventListener('justsoc-claude-bridge-open-task', handleOpenTaskEvent as EventListener);
    return () => {
      window.removeEventListener('justsoc-claude-bridge-create-task', handleCreateTaskEvent as EventListener);
      window.removeEventListener('justsoc-claude-bridge-open-task', handleOpenTaskEvent as EventListener);
    };
  }, []);

  function beginResize(event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    resizeStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startWidth: windowSize.width,
      startHeight: windowSize.height,
    };
    document.body.style.userSelect = 'none';
  }

  function startNewTaskDraft() {
    closeEventStream();
    setActiveTaskId(null);
    setCurrentTask(null);
    setPartialAssistantText('');
    setDraft('');
    setHistoryPanelOpen(false);
    setDecisionMessage('');
    setUpdatedInputJson('');
    setQuestionAnswers({});
    setExpandedProcessByExchange({});
    pendingAutoScrollRef.current = false;
    previousRenderedCountRef.current = 0;
    if (typeof window !== 'undefined') {
      persistCurrentTaskId(null);
    }
  }

  async function createTaskFromPrompt(prompt: string, title?: string) {
    closeEventStream();
    startNewTaskDraft();
    setSending(true);

    try {
      const payload = await fetchJson<{ task: ClaudeBridgeTaskSnapshot }>('/api/claude-bridge/tasks', {
        method: 'POST',
        body: JSON.stringify({
          prompt,
          title,
        }),
      });

      setActiveTaskId(payload.task.id);
      if (typeof window !== 'undefined') {
        persistCurrentTaskId(payload.task.id);
      }
      setCurrentTask(payload.task);
      upsertTask(payload.task);
      connectTaskStream(payload.task.id);
      await loadTaskList();
      return payload.task;
    } catch (error) {
      const message = error instanceof Error ? error.message : '创建任务失败。';
      setCurrentTask((current) => current ? {
        ...current,
        logs: current.logs.concat({
          id: `local-error-${Date.now()}`,
          kind: 'error',
          createdAt: new Date().toISOString(),
          text: message,
        }),
      } : {
        id: `local-draft-${Date.now()}`,
        title: title || '新任务',
        status: 'error',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        currentTurn: 0,
        lastError: message,
        logs: [{
          id: `local-error-${Date.now()}`,
          kind: 'error',
          createdAt: new Date().toISOString(),
          text: message,
        }],
        sdkSession: { sessionId: 'local-draft' },
      });
      return null;
    } finally {
      setSending(false);
    }
  }

  async function selectTask(taskId: string) {
    setActiveTaskId(taskId);
    if (typeof window !== 'undefined') {
      persistCurrentTaskId(taskId);
    }
    setHistoryPanelOpen(false);
    await loadTask(taskId);
    connectTaskStream(taskId);
  }

  async function interruptCurrentTask() {
    if (!currentTask) {
      return;
    }

    const payload = await fetchJson<{ task: ClaudeBridgeTaskSnapshot }>(`/api/claude-bridge/tasks/${encodeURIComponent(currentTask.id)}/interrupt`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    setCurrentTask(payload.task);
    upsertTask(payload.task);
  }

  async function deleteTask(taskId: string) {
    const confirmed = window.confirm('确认删除这条历史任务吗？删除后将无法从历史列表恢复。');
    if (!confirmed) {
      return;
    }

    await fetchJson<{ task: ClaudeBridgeTaskSnapshot }>(`/api/claude-bridge/tasks/${encodeURIComponent(taskId)}`, {
      method: 'DELETE',
    });

    setTasks((current) => current.filter((task) => task.id !== taskId));

    if (activeTaskId === taskId) {
      startNewTaskDraft();
    }
  }

  async function submitDecision(decision: 'allow' | 'allow_always' | 'deny') {
    if (!currentTask?.pendingRequest) {
      return;
    }

    const payload = await fetchJson<{ task: ClaudeBridgeTaskSnapshot }>(`/api/claude-bridge/tasks/${encodeURIComponent(currentTask.id)}/decision`, {
      method: 'POST',
      body: JSON.stringify({
        requestId: currentTask.pendingRequest.requestId,
        decision,
        message: decisionMessage.trim() || undefined,
        updatedInputJson: updatedInputJson.trim() || undefined,
        answers: currentTask.pendingRequest.mode === 'question' ? questionAnswers : undefined,
      }),
    });

    setCurrentTask(payload.task);
    upsertTask(payload.task);
    setDecisionMessage('');
    setUpdatedInputJson('');
    setQuestionAnswers({});
  }

  function updateQuestionAnswer(questionId: string, value: string | string[]) {
    setQuestionAnswers((current) => ({
      ...current,
      [questionId]: value,
    }));
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || sending) {
      return;
    }

    setSending(true);
    try {
      if (!activeTaskId) {
        setDraft('');
        await createTaskFromPrompt(content);
      } else {
        const payload = await fetchJson<{ task: ClaudeBridgeTaskSnapshot }>(`/api/claude-bridge/tasks/${encodeURIComponent(activeTaskId)}/messages`, {
          method: 'POST',
          body: JSON.stringify({ content }),
        });

        setDraft('');
        setCurrentTask(payload.task);
        upsertTask(payload.task);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '发送失败。';
      setCurrentTask((current) => current ? {
        ...current,
        logs: current.logs.concat({
          id: `local-error-${Date.now()}`,
          kind: 'error',
          createdAt: new Date().toISOString(),
          text: message,
        }),
      } : current);
    } finally {
      setSending(false);
    }
  }

  const currentTaskLabel = currentTask?.title || '新任务';
  const currentStatus = currentTask?.status ?? 'draft';
  const pendingQuestions = extractQuestionList(currentTask?.pendingRequest);
  const disableComposer = sending || loadingTask || currentStatus === 'running' || currentStatus === 'waiting_input';

  return (
    <>
      <button
        type="button"
        className="justsoc-chat-placeholder"
        onClick={() => setOpen((current) => !current)}
        title="打开 Claude 任务聊天"
        aria-label="打开 Claude 任务聊天"
      >
        <span className="justsoc-chat-placeholder-glow" aria-hidden="true" />
        <span className="justsoc-chat-placeholder-core" aria-hidden="true" />
        <span className="justsoc-chat-placeholder-orbit-shell" aria-hidden="true">
          <span className="justsoc-chat-placeholder-orbit justsoc-chat-placeholder-orbit-a">
            <span className="justsoc-chat-placeholder-satellite" />
          </span>
          <span className="justsoc-chat-placeholder-orbit justsoc-chat-placeholder-orbit-b">
            <span className="justsoc-chat-placeholder-satellite justsoc-chat-placeholder-satellite-small" />
          </span>
          <span className="justsoc-chat-placeholder-orbit justsoc-chat-placeholder-orbit-c">
            <span className="justsoc-chat-placeholder-satellite justsoc-chat-placeholder-satellite-tiny" />
          </span>
        </span>
        <span className="justsoc-chat-placeholder-text">CC</span>
      </button>

      {open ? (
        <section
          className="justsoc-chat-fallback justsoc-chat-fallback-open"
          role="dialog"
          aria-modal="false"
          aria-label="Claude 任务聊天"
          style={{ width: `${windowSize.width}px`, height: `${windowSize.height}px` }}
        >
          <button
            type="button"
            className="justsoc-chat-fallback-resize-handle"
            onMouseDown={beginResize}
            aria-label="调整聊天窗口大小"
            title="拖动调整窗口大小"
          />

          <header className="justsoc-chat-fallback-header">
            <div className="justsoc-chat-fallback-header-top">
              <div>
                <div className="justsoc-chat-fallback-title">Claude Code Bridge</div>
                <div className="justsoc-chat-fallback-subtitle">
                  以任务会话方式创建、续聊和恢复 Claude Code 任务。
                </div>
              </div>
              <button
                className="justsoc-chat-close-button"
                type="button"
                onClick={() => setOpen(false)}
                aria-label="关闭聊天"
                title="关闭"
              >
                ×
              </button>
            </div>

            <div className="justsoc-chat-session-toolbar">
              <div className="justsoc-chat-current-session" title={currentTaskLabel}>
                <span className="justsoc-chat-current-session-dot" />
                <span className="justsoc-chat-current-session-text">{currentTaskLabel}</span>
                <span className={`status-pill ${taskStatusTone(currentStatus)}`}>{currentStatus}</span>
              </div>
              <div className="justsoc-chat-fallback-actions">
                <button className="button button-primary justsoc-chat-toolbar-button" type="button" onClick={startNewTaskDraft}>新任务</button>
                <button
                  className={`button justsoc-chat-toolbar-button${historyPanelOpen ? ' justsoc-chat-toolbar-button-active' : ''}`}
                  type="button"
                  onClick={() => setHistoryPanelOpen((current) => !current)}
                >
                  {historyPanelOpen ? '返回' : '历史任务'}
                </button>
                {currentTask && (currentTask.status === 'running' || currentTask.status === 'waiting_input') ? (
                  <button className="button justsoc-chat-toolbar-button" type="button" onClick={() => void interruptCurrentTask()}>
                    中断
                  </button>
                ) : null}
              </div>
            </div>
          </header>

          <div className="justsoc-chat-fallback-main">
            <div
              ref={chatBodyRef}
              className="justsoc-chat-fallback-body"
              onMouseDown={() => {
                bodyInteractionRef.current = true;
              }}
            >
              {!currentTask && !loadingTask ? (
                <div className="justsoc-chat-empty-shell">
                  <article className="justsoc-chat-fallback-message justsoc-chat-fallback-message-system">
                    <div className="justsoc-chat-fallback-message-role">系统</div>
                    <div className="justsoc-chat-fallback-message-content">这里已经切换为 Claude Code Bridge 任务会话模式。</div>
                  </article>
                  <article className="justsoc-chat-fallback-message justsoc-chat-fallback-message-system">
                    <div className="justsoc-chat-fallback-message-role">系统</div>
                    <div className="justsoc-chat-fallback-message-content">直接在下方输入第一条消息即可创建任务，或通过“历史任务”恢复旧任务。</div>
                  </article>
                </div>
              ) : loadingTask ? (
                <div className="empty-hint">正在加载任务快照...</div>
              ) : (
                exchanges.map((exchange, index) => {
                  const processExpanded = expandedProcessByExchange[exchange.key] === true;
                  return (
                    <section className="justsoc-chat-exchange" key={exchange.key}>
                      <article
                        className="justsoc-chat-fallback-message justsoc-chat-fallback-message-user"
                        style={{ '--message-index': index * 2 } as CSSProperties}
                      >
                        <div className="justsoc-chat-fallback-message-role">你</div>
                        <div className="justsoc-chat-fallback-message-content">{getDisplayUserText(exchange.userEntry)}</div>
                      </article>

                      <article
                        className={`justsoc-chat-conversation-reply justsoc-chat-conversation-reply-${exchange.tone}`}
                        style={{ '--message-index': index * 2 + 1 } as CSSProperties}
                      >
                        <div className="justsoc-chat-conversation-reply-head">
                          <span className="justsoc-chat-fallback-message-role">回复</span>
                          <span className={`status-pill ${exchange.tone === 'success' ? 'status-green' : exchange.tone === 'error' ? 'status-red' : exchange.tone === 'pending' ? 'status-yellow' : 'status-gray'}`}>
                            {exchange.tone === 'success' ? '结论' : exchange.tone === 'error' ? '错误' : exchange.tone === 'pending' ? '进行中' : '回复'}
                          </span>
                        </div>

                        <div className="justsoc-chat-conversation-reply-content">
                          <ControlledMarkdown content={exchange.assistantText || '处理中...'} />
                        </div>

                        {exchange.pendingRequest ? (
                          <div className="justsoc-chat-inline-pending">
                            <div className="justsoc-chat-inline-pending-title">
                              {exchange.pendingRequest.mode === 'question'
                                ? `等待回答：${exchange.pendingRequest.toolName}`
                                : `等待授权：${exchange.pendingRequest.toolName}`}
                            </div>
                            <div className="justsoc-chat-inline-pending-subtitle">
                              {exchange.pendingRequest.decisionReason || '请在这里完成当前轮次所需的权限决策或问答。'}
                            </div>

                            {exchange.pendingRequest.mode === 'question' ? (
                              <div className="justsoc-chat-question-list">
                                {pendingQuestions.map((question) => (
                                  <div className="justsoc-chat-question-card" key={question.id}>
                                    <div className="justsoc-chat-question-title">{question.prompt}</div>
                                    {question.options.length ? (
                                      <div className="justsoc-chat-question-options">
                                        {question.options.map((option) => {
                                          const currentValue = questionAnswers[question.id];
                                          const checked = Array.isArray(currentValue)
                                            ? currentValue.includes(option.label)
                                            : currentValue === option.label;

                                          return (
                                            <label className="justsoc-chat-question-option" key={option.label}>
                                              <input
                                                type={question.multiSelect ? 'checkbox' : 'radio'}
                                                name={question.id}
                                                checked={checked}
                                                onChange={(event) => {
                                                  if (question.multiSelect) {
                                                    const next = Array.isArray(currentValue) ? [...currentValue] : [];
                                                    if (event.target.checked) {
                                                      if (!next.includes(option.label)) next.push(option.label);
                                                    } else {
                                                      updateQuestionAnswer(question.id, next.filter((item) => item !== option.label));
                                                      return;
                                                    }
                                                    updateQuestionAnswer(question.id, next);
                                                    return;
                                                  }
                                                  updateQuestionAnswer(question.id, option.label);
                                                }}
                                              />
                                              <span>{option.label}</span>
                                            </label>
                                          );
                                        })}
                                      </div>
                                    ) : null}
                                    <textarea
                                      className="textarea"
                                      value={typeof questionAnswers[question.id] === 'string' ? questionAnswers[question.id] as string : ''}
                                      onChange={(event) => updateQuestionAnswer(question.id, event.target.value)}
                                      placeholder="可选的自由回答"
                                    />
                                  </div>
                                ))}
                              </div>
                            ) : null}

                            <textarea
                              className="textarea"
                              value={decisionMessage}
                              onChange={(event) => setDecisionMessage(event.target.value)}
                              placeholder={exchange.pendingRequest.mode === 'approval' ? '可选：拒绝理由或补充说明' : '可选：补充说明'}
                            />

                            <textarea
                              className="textarea"
                              value={updatedInputJson}
                              onChange={(event) => setUpdatedInputJson(event.target.value)}
                              placeholder="高级：覆盖 updatedInput JSON（可选）"
                            />

                            <div className="toolbar-group">
                              <button className="button button-primary" type="button" onClick={() => void submitDecision('allow')}>
                                {exchange.pendingRequest.mode === 'question' ? '提交回答' : '允许一次'}
                              </button>
                              {exchange.pendingRequest.mode === 'approval' && exchange.pendingRequest.suggestionsAvailable ? (
                                <button className="button" type="button" onClick={() => void submitDecision('allow_always')}>
                                  永久允许
                                </button>
                              ) : null}
                              <button className="button" type="button" onClick={() => void submitDecision('deny')}>拒绝</button>
                            </div>
                          </div>
                        ) : null}

                        {exchange.processEntries.length > 0 ? (
                          <div className="justsoc-chat-process-inline">
                            <button
                              type="button"
                              className="justsoc-chat-process-toggle"
                              onClick={() => setExpandedProcessByExchange((current) => ({
                                ...current,
                                [exchange.key]: !processExpanded,
                              }))}
                            >
                              <span className="justsoc-chat-process-toggle-title">中间过程</span>
                              <span className="justsoc-chat-process-toggle-meta">
                                {processExpanded ? '点击折叠' : `默认已折叠，共 ${exchange.processEntries.length} 条`}
                              </span>
                            </button>

                            {processExpanded ? (
                              <div className="justsoc-chat-process-list">
                                {exchange.processEntries.map((entry) => (
                                  <article key={entry.id} className={`justsoc-chat-process-entry ${mapProcessLogClass(entry)}`}>
                                    <div className="justsoc-chat-process-entry-kind">{entry.kind}</div>
                                    <div className="justsoc-chat-process-entry-content">{fetchEntryText(entry)}</div>
                                  </article>
                                ))}
                                {exchange.partialText ? (
                                  <article className="justsoc-chat-process-entry justsoc-chat-process-entry-progress">
                                    <div className="justsoc-chat-process-entry-kind">assistant.partial</div>
                                    <div className="justsoc-chat-process-entry-content">{exchange.partialText}</div>
                                  </article>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </article>
                    </section>
                  );
                })
              )}
            </div>

            {historyPanelOpen ? (
              <div className="justsoc-chat-session-overlay">
                <div className="justsoc-chat-session-overlay-header">
                  <div>
                    <div className="justsoc-chat-session-overlay-title">任务历史</div>
                    <div className="justsoc-chat-session-overlay-subtitle">这里展示的是 Claude Code Bridge 已持久化的任务记录。</div>
                  </div>
                </div>
                <div className="justsoc-chat-session-panel">
                  {tasks.length === 0 ? (
                    <div className="empty-hint">暂时还没有历史任务。</div>
                  ) : (
                    tasks.map((task) => (
                      <div className="justsoc-chat-session-row" key={task.id}>
                        <button
                          type="button"
                          className={`justsoc-chat-session-item${task.id === activeTaskId ? ' justsoc-chat-session-item-active' : ''}`}
                          onClick={() => void selectTask(task.id)}
                        >
                          <span className="justsoc-chat-session-title">{task.title}</span>
                          <span className="justsoc-chat-session-meta">
                            {formatSessionTime(task.updatedAt)} · {task.status} · 第 {task.currentTurn} 轮
                          </span>
                          <span className="justsoc-chat-session-preview">{task.lastError || task.result?.text || task.logs[task.logs.length - 1]?.text || '暂无预览'}</span>
                        </button>
                        <button
                          type="button"
                          className="justsoc-chat-session-delete"
                          onClick={() => void deleteTask(task.id)}
                          aria-label="删除历史任务"
                          title="删除历史任务"
                        >
                          删除
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </div>

          <form className="justsoc-chat-fallback-form" onSubmit={sendMessage}>
            <textarea
              className="textarea justsoc-chat-fallback-textarea"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={activeTaskId ? '继续当前任务对话...' : '描述你要 Claude Code 执行的首个任务...'}
            />
            <button className="button button-primary" type="submit" disabled={disableComposer || !draft.trim()}>
              {sending ? '发送中...' : activeTaskId ? '续聊任务' : '创建任务'}
            </button>
          </form>
        </section>
      ) : null}
    </>
  );
}
