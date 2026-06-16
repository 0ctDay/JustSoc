import type { AlertFieldDefinition } from '@/lib/alert-fields';

const fullWidthLabels = new Set([
  'HTTP URL',
  '可打印 Payload',
  '原始 Payload',
  '原始 Packet',
]);

function getValueByPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function renderValue(value: unknown, fullWidth?: boolean) {
  if (value == null) return <span className="muted">-</span>;
  if (typeof value === 'boolean') return String(value);
  if (fullWidth) {
    return <pre className="field-value-pre">{String(value)}</pre>;
  }
  return String(value);
}

export default function FieldValuesPanel({
  document,
  fields,
}: {
  document: Record<string, unknown> | undefined;
  fields: AlertFieldDefinition[];
}) {
  if (!document) {
    return <div className="empty-hint">当前告警没有原始日志数据，无法展示字段值。</div>;
  }

  return (
    <div className="field-values-panel">
      <div className="field-values-grid">
        {fields.filter((field) => !fullWidthLabels.has(field.label)).map((field) => {
          const value = getValueByPath(document, field.name);
          return (
            <div className="field-value-row" key={`${field.label}-${field.name}`}>
              <div className="field-value-label">{field.label}</div>
              <div className="field-value-content">{renderValue(value)}</div>
            </div>
          );
        })}
      </div>
      <div className="field-values-fullwidth">
        {fields.filter((field) => fullWidthLabels.has(field.label)).map((field) => {
          const value = getValueByPath(document, field.name);
          return (
            <div className="field-value-full-row" key={`${field.label}-${field.name}`}>
              <div className="field-value-label">{field.label}</div>
              <div className="field-value-content">{renderValue(value, true)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}