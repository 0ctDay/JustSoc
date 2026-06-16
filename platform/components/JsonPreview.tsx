'use client';

type JsonPreviewProps = {
  value: unknown;
  emptyText?: string;
};

export default function JsonPreview({ value, emptyText = '暂无 JSON 内容。' }: JsonPreviewProps) {
  if (value === null || value === undefined || value === '') {
    return <div className="empty-hint">{emptyText}</div>;
  }

  return (
    <pre className="code code-block json-preview">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
