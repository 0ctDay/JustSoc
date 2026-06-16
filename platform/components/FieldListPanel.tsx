import { useMemo, useState } from 'react';
import type { AlertFieldDefinition } from '@/lib/alert-fields';

function readDraggedField(event: React.DragEvent<HTMLElement>) {
  return event.dataTransfer.getData('text/plain');
}

export default function FieldListPanel({
  fields,
  selectedFields,
  selectedStatsField,
  onAddField,
  onRemoveField,
  onReorderSelectedField,
  onSelectStatsField,
}: {
  fields: AlertFieldDefinition[];
  selectedFields: string[];
  selectedStatsField: string | null;
  onAddField: (fieldName: string) => void;
  onRemoveField: (fieldName: string) => void;
  onReorderSelectedField: (draggedField: string, targetField: string | null) => void;
  onSelectStatsField: (fieldName: string) => void;
}) {
  const [keyword, setKeyword] = useState('');

  const filteredFields = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    if (!normalized) return fields;
    return fields.filter((field) => field.name.toLowerCase().includes(normalized) || field.label.toLowerCase().includes(normalized));
  }, [fields, keyword]);

  function startDragging(event: React.DragEvent<HTMLElement>, fieldName: string) {
    event.dataTransfer.setData('text/plain', fieldName);
    event.dataTransfer.effectAllowed = 'move';
  }

  return (
    <div className="field-panel" style={{ fontSize: '10px' }}>
      <div className="toolbar-group">
        <input className="input" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索字段" />
      </div>

      <div className="field-section">
        <div className="field-section-title">已选字段</div>
        <div
          className="field-dropzone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            const draggedField = readDraggedField(event);
            if (draggedField) onReorderSelectedField(draggedField, null);
          }}
        >
          {selectedFields.length === 0 ? (
            <div className="empty-hint">将下方字段拖到这里，作为结果表列。</div>
          ) : (
            <ul className="field-list">
              {selectedFields.map((fieldName) => {
                const field = fields.find((item) => item.name === fieldName);
                if (!field) return null;
                return (
                  <li
                    className={`field-item field-item-selected ${selectedStatsField === field.name ? 'field-item-active' : ''}`}
                    draggable
                    key={field.name}
                    onClick={() => onSelectStatsField(field.name)}
                    onDragOver={(event) => event.preventDefault()}
                    onDragStart={(event) => startDragging(event, field.name)}
                    onDrop={(event) => {
                      const draggedField = readDraggedField(event);
                      if (draggedField && draggedField !== field.name) {
                        onReorderSelectedField(draggedField, field.name);
                      }
                    }}
                  >
                    <div className="field-item-main field-item-main-clickable">
                      <div className="field-item-title">{field.label}</div>
                    </div>
                    <div className="field-item-actions">
                      <button className="field-icon-button" type="button" onClick={(event) => { event.stopPropagation(); onRemoveField(field.name); }} aria-label={`移除字段 ${field.label}`}>
                        -
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="field-section">
        <div className="field-section-title">可用字段（拖到上方）</div>
        <ul className="field-list">
          {filteredFields.map((field) => {
            const fixedTitle = field.key === 'alertSignature';
            const selected = selectedFields.includes(field.name);
            return (
              <li
                className={`field-item ${selected ? 'field-item-disabled' : ''} ${selectedStatsField === field.name ? 'field-item-active' : ''}`}
                draggable={!fixedTitle && !selected}
                key={field.name}
                onClick={() => field.aggregatable && onSelectStatsField(field.name)}
                onDragStart={(event) => startDragging(event, field.name)}
              >
                <div className="field-item-main field-item-main-clickable">
                  <div className="field-item-title">{field.label}</div>
                  {fixedTitle ? <div className="muted field-path">固定为首列标题</div> : null}
                </div>
                <div className="field-item-actions">
                  {!fixedTitle && !selected ? (
                    <button className="field-icon-button" type="button" onClick={(event) => { event.stopPropagation(); onAddField(field.name); }} aria-label={`添加字段 ${field.label}`}>
                      +
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
