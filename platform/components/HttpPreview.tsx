type HighlightRange = { start: number; end: number };

type MessagePreview = {
  raw?: string;
  //body?: string;
  highlights?: HighlightRange[];
};

function renderHighlighted(raw: string, ranges: HighlightRange[] = []) {
  if (!ranges.length) {
    return raw;
  }

  const parts: Array<string | JSX.Element> = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    const safeStart = Math.max(0, range.start);
    const safeEnd = Math.max(safeStart, range.end);
    if (safeStart > cursor) {
      parts.push(raw.slice(cursor, safeStart));
    }
    parts.push(
      <mark className="http-highlight" key={`${safeStart}-${safeEnd}-${index}`}>
        {raw.slice(safeStart, safeEnd)}
      </mark>,
    );
    cursor = safeEnd;
  });
  if (cursor < raw.length) {
    parts.push(raw.slice(cursor));
  }
  return parts;
}

function Pane({ title, bodyTitle, emptyBodyText, message }: { title: string; bodyTitle: string; emptyBodyText: string; message?: MessagePreview }) {
  const raw = message?.raw ?? '';
  //onst body = message?.body ?? '';
  return (
    <article className="card http-pane">
      <h3 className="section-card-title">{title}</h3>
      {raw ? <pre className="code code-block http-code">{renderHighlighted(raw, message?.highlights)}</pre> : <div className="empty-hint">暂无内容。</div>}
      <h4 className="http-subtitle">{bodyTitle}</h4>
    </article>
  );
  //      {body ? <pre className="code code-block http-code">{body}</pre> : <div className="empty-hint">{emptyBodyText}</div>}
}

export default function HttpPreview({
  request,
  response,
}: {
  request?: MessagePreview;
  response?: MessagePreview;
}) {
  return (
    <div className="http-preview">
      <div className="http-pane-grid">
        <Pane title="HTTP 请求包" bodyTitle="请求体" emptyBodyText="当前没有单独的请求体。" message={request} />
        <Pane title="HTTP 响应包" bodyTitle="" emptyBodyText="当前没有单独的响应体。" message={response} />
      </div>
    </div>
  );
}
