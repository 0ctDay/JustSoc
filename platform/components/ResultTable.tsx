import { useEffect, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';

type AlertHit = {
  _id: string;
  _index: string;
  _source?: Record<string, unknown>;
};

type ResizeState = {
  fieldName: string;
  startX: number;
  startWidth: number;
} | null;

type ActiveAction = {
  key: string;
  fieldName: string;
  value: string;
  filterValue: string;
  hit: AlertHit;
  isTitle: boolean;
} | null;

function getFieldValue(source: Record<string, unknown> | undefined, path: string): unknown {
  if (!source) return undefined;
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object' || !(key in (current as Record<string, unknown>))) {
      return undefined;
    }
    return (current as Record<string, unknown>)[key];
  }, source);
}

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function formatTimestampToSeconds(value: unknown) {
  const raw = formatValue(value);
  if (raw === '-') return raw;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, '0');
    const dd = String(parsed.getDate()).padStart(2, '0');
    const hh = String(parsed.getHours()).padStart(2, '0');
    const mi = String(parsed.getMinutes()).padStart(2, '0');
    const ss = String(parsed.getSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
  }
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2}:\d{2})/);
  if (match) return `${match[1]} ${match[2]}`;
  return raw;
}

function severityTone(value: unknown) {
  if (value === null || value === undefined || value === '') return 'status-gray';
  const numeric = typeof value === 'number' ? value : Number(value);
  if (Number.isFinite(numeric)) {
    if (numeric <= 1) return 'status-red';
    if (numeric === 2) return 'status-yellow';
    if (numeric >= 3) return 'status-green';
  }
  const normalized = String(value).trim().toLowerCase();
  if (['critical', 'crit', 'high', 'severe', '严重', '高', '高危', '紧急'].includes(normalized)) return 'status-red';
  if (['medium', 'med', 'moderate', 'warning', '中', '中危', '中等'].includes(normalized)) return 'status-yellow';
  if (['low', 'info', 'informational', 'notice', '低', '低危', '提示'].includes(normalized)) return 'status-green';
  return 'status-gray';
}

function attackStageTone(value: unknown) {
  if (value === 'confirmed_success') return 'status-red';
  if (value === 'probable_success') return 'status-yellow';
  return 'status-gray';
}

function attackSuccessLabel(value: unknown) {
  if (value === true || value === 'true') return '攻击成功';
  if (value === false || value === 'false') return '攻击未成功';
  return String(value ?? '-');
}

function sortSuffix(fieldName: string, sortField: string, sortOrder: 'asc' | 'desc') {
  if (sortField !== fieldName) return '';
  return sortOrder === 'asc' ? ' ▲' : ' ▼';
}

export default function ResultTable({
  hits,
  titleField = 'alert.signature',
  selectedFields,
  fieldLabels,
  fieldKeys,
  queryFields,
  sortField,
  sortOrder,
  readAlertIds,
  columnWidths,
  onSortChange,
  onSelectAlert,
  onReorderColumns,
  onColumnWidthChange,
  onQuickFilter,
}: {
  hits: AlertHit[];
  titleField?: string;
  selectedFields: string[];
  fieldLabels: Record<string, string>;
  fieldKeys: Record<string, string>;
  queryFields: Record<string, string>;
  sortField: string;
  sortOrder: 'asc' | 'desc';
  readAlertIds: string[];
  columnWidths: Record<string, number>;
  onSortChange: (fieldName: string) => void;
  onSelectAlert: (hit: AlertHit, event: ReactMouseEvent<HTMLButtonElement>) => void;
  onReorderColumns: (draggedField: string, targetField: string) => void;
  onColumnWidthChange: (fieldName: string, width: number) => void;
  onQuickFilter: (fieldName: string, value: string, mode: 'include' | 'exclude') => void;
}) {
  const [resizeState, setResizeState] = useState<ResizeState>(null);
  const [activeAction, setActiveAction] = useState<ActiveAction>(null);

  useEffect(() => {
    if (!resizeState) return undefined;
    const activeResize = resizeState;

    function onMouseMove(event: MouseEvent) {
      const nextWidth = Math.max(90, activeResize.startWidth + (event.clientX - activeResize.startX));
      onColumnWidthChange(activeResize.fieldName, nextWidth);
    }

    function onMouseUp() {
      setResizeState(null);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [onColumnWidthChange, resizeState]);

  useEffect(() => {
    if (!activeAction) return undefined;
    function closeActions() {
      setActiveAction(null);
    }
    window.addEventListener('click', closeActions);
    return () => window.removeEventListener('click', closeActions);
  }, [activeAction]);

  function headerWidth(fieldName: string) {
    return columnWidths[fieldName] ?? (fieldName === titleField ? 260 : 150);
  }

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setActiveAction(null);
  }

  function renderActionMenu(action: NonNullable<ActiveAction>) {
    return (
      <span className="field-action-popover" onClick={(event) => event.stopPropagation()}>
        <button className="field-inline-button" type="button" title="包含筛选" aria-label="包含筛选" onClick={() => { onQuickFilter(action.fieldName, action.filterValue, 'include'); setActiveAction(null); }}>
          <span aria-hidden="true">+</span>
        </button>
        <button className="field-inline-button" type="button" title="排除筛选" aria-label="排除筛选" onClick={() => { onQuickFilter(action.fieldName, action.filterValue, 'exclude'); setActiveAction(null); }}>
          <span aria-hidden="true">−</span>
        </button>
        <button className="field-inline-button" type="button" title="复制" aria-label="复制" onClick={() => void copyText(action.value)}>
          <span aria-hidden="true">⧉</span>
        </button>
        {action.isTitle ? (
          <button className="field-inline-button field-detail-button" type="button" title="查看详情" aria-label="查看详情" onClick={(event) => { setActiveAction(null); onSelectAlert(action.hit, event); }}>
            <span aria-hidden="true">↗</span>
          </button>
        ) : null}
      </span>
    );
  }

  function renderValueAction({
    hit,
    fieldName,
    formattedValue,
    actionValue,
    className,
    isTitle = false,
    children,
  }: {
    hit: AlertHit;
    fieldName: string;
    formattedValue: string;
    actionValue?: string;
    className: string;
    isTitle?: boolean;
    children: ReactNode;
  }) {
    const actionKey = `${hit._id}-${fieldName}`;
    if (formattedValue === '-') return <span title={formattedValue}>{children}</span>;
    const active = activeAction?.key === actionKey;

    return (
      <span className="field-value-chip-wrap">
        <button
          className={className}
          type="button"
          title={formattedValue}
          onClick={(event) => {
            event.stopPropagation();
            setActiveAction((current) => current?.key === actionKey ? null : {
              key: actionKey,
              fieldName,
              value: formattedValue,
              filterValue: actionValue ?? formattedValue,
              hit,
              isTitle,
            });
          }}
        >
          {children}
        </button>
        {active && activeAction ? renderActionMenu(activeAction) : null}
      </span>
    );
  }

  function renderHeader(fieldName: string, draggable = false) {
    return (
      <th
        draggable={draggable}
        key={fieldName}
        style={{ width: `${headerWidth(fieldName)}px`, minWidth: `${headerWidth(fieldName)}px` }}
        onDragOver={(event) => event.preventDefault()}
        onDragStart={(event) => {
          event.dataTransfer.setData('text/plain', fieldName);
          event.dataTransfer.effectAllowed = 'move';
        }}
        onDrop={(event) => {
          const draggedField = event.dataTransfer.getData('text/plain');
          if (draggedField && draggedField !== fieldName) onReorderColumns(draggedField, fieldName);
        }}
      >
        <div className="column-header-shell">
          <div className="column-header-drag">
            {draggable ? <span className="column-drag-handle" aria-hidden="true" title="拖动调整列顺序">⠿</span> : null}
            <button className="link-button" type="button" onClick={() => onSortChange(fieldName)}>
              {fieldLabels[fieldName] ?? fieldName}{sortSuffix(fieldName, sortField, sortOrder)}
            </button>
          </div>
          <div
            className="column-resizer"
            onMouseDown={(event) => {
              event.preventDefault();
              setResizeState({
                fieldName,
                startX: event.clientX,
                startWidth: headerWidth(fieldName),
              });
            }}
          />
        </div>
      </th>
    );
  }

  return (
    <div className="table-wrap">
      <table className="table table-fixed">
        <thead>
          <tr>
            {renderHeader(titleField)}
            {selectedFields.map((fieldName) => renderHeader(fieldName, true))}
          </tr>
        </thead>
        <tbody>
          {hits.map((hit) => {
            const isRead = readAlertIds.includes(hit._id);
            const titleValue = formatValue(getFieldValue(hit._source, titleField) ?? getFieldValue(hit._source, 'event_type'));

            return (
              <tr key={hit._id} className={isRead ? 'row-read' : 'row-unread'}>
                <td style={{ width: `${headerWidth(titleField)}px`, minWidth: `${headerWidth(titleField)}px` }}>
                  {renderValueAction({
                    hit,
                    fieldName: titleField,
                    formattedValue: titleValue,
                    className: 'table-row-button table-value-button',
                    isTitle: true,
                    children: (
                      <>
                        <span className={`read-indicator ${isRead ? 'read-indicator-read' : 'read-indicator-unread'}`} />
                        <span className="table-cell-text">{titleValue}</span>
                      </>
                    ),
                  })}
                </td>
                {selectedFields.map((fieldName) => {
                  const value = getFieldValue(hit._source, fieldName);
                  const fieldKey = fieldKeys[fieldName];
                  const formattedValue = fieldKey === 'timestamp' ? formatTimestampToSeconds(value) : formatValue(value);
                  const quickField = queryFields[fieldName];

                  let content: ReactNode;
                  if (fieldKey === 'eventSeverity') {
                    content = renderValueAction({ hit, fieldName, formattedValue, className: `status-pill status-pill-button ${severityTone(value)}`, children: formattedValue });
                  } else if (fieldKey === 'attackStage') {
                    content = renderValueAction({ hit, fieldName, formattedValue, className: `status-pill status-pill-button ${attackStageTone(value)}`, children: formattedValue });
                  } else if (fieldKey === 'attackSuccess') {
                    const label = attackSuccessLabel(value);
                    content = renderValueAction({
                      hit,
                      fieldName,
                      formattedValue: label,
                      actionValue: String(value === true || value === 'true'),
                      className: `status-pill status-pill-button ${(value === true || value === 'true') ? 'status-red' : 'status-gray'}`,
                      children: label,
                    });
                  } else if (fieldKey === 'attackSuccessConfidence') {
                    content = renderValueAction({ hit, fieldName, formattedValue, className: `status-pill status-pill-button ${value === 'high' ? 'status-red' : value === 'medium' ? 'status-yellow' : 'status-gray'}`, children: formattedValue });
                  } else if (quickField && formattedValue !== '-') {
                    content = renderValueAction({ hit, fieldName, formattedValue, className: 'field-value-chip', children: formattedValue });
                  } else {
                    content = <span className="table-cell-text" title={formattedValue}>{formattedValue}</span>;
                  }

                  return (
                    <td key={`${hit._id}-${fieldName}`} style={{ width: `${headerWidth(fieldName)}px`, minWidth: `${headerWidth(fieldName)}px` }}>
                      {content}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
