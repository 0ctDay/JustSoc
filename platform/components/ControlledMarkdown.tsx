'use client';

import type { ReactNode } from 'react';

type TableAlign = 'left' | 'center' | 'right';

type Block =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'blockquote'; text: string[] }
  | { type: 'code'; language: string; code: string }
  | { type: 'table'; header: string[]; rows: string[][]; aligns: TableAlign[] };

function splitTableRow(line: string) {
  let working = line.trim();
  if (working.startsWith('|')) working = working.slice(1);
  if (working.endsWith('|')) working = working.slice(0, -1);
  return working.split('|').map((cell) => cell.trim());
}

function isTableSeparator(line: string) {
  if (!line.includes('|')) return false;
  const cells = splitTableRow(line);
  if (cells.length === 0) return false;
  return cells.every((cell) => /^:?-{1,}:?$/.test(cell.replace(/\s+/g, '')));
}

function alignFromSeparator(cell: string): TableAlign {
  const compact = cell.replace(/\s+/g, '');
  const starts = compact.startsWith(':');
  const ends = compact.endsWith(':');
  if (starts && ends) return 'center';
  if (ends) return 'right';
  return 'left';
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\((https?:\/\/[^\s)]+)\))/g;
  let lastIndex = 0;
  let tokenIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const token = match[0];
    const index = match.index ?? 0;

    if (index > lastIndex) {
      nodes.push(text.slice(lastIndex, index));
    }

    if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code key={`${keyPrefix}-code-${tokenIndex}`} className="markdown-inline-code">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(
        <strong key={`${keyPrefix}-strong-${tokenIndex}`}>
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith('[')) {
      const linkMatch = token.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      if (linkMatch) {
        nodes.push(
          <a
            key={`${keyPrefix}-link-${tokenIndex}`}
            href={linkMatch[2]}
            target="_blank"
            rel="noreferrer"
          >
            {linkMatch[1]}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    } else {
      nodes.push(token);
    }

    lastIndex = index + token.length;
    tokenIndex += 1;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function parseMarkdown(markdown: string): Block[] {
  const normalized = markdown.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return [];
  }

  const lines = normalized.split('\n');
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: 'code', language, code: codeLines.join('\n') });
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length as 1 | 2 | 3,
        text: headingMatch[2].trim(),
      });
      index += 1;
      continue;
    }

    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith('>')) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'blockquote', text: quoteLines });
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ''));
        index += 1;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ''));
        index += 1;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    if (trimmed.includes('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const header = splitTableRow(trimmed);
      const aligns = splitTableRow(lines[index + 1]).map(alignFromSeparator);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length) {
        const rowLine = lines[index];
        const rowTrimmed = rowLine.trim();
        if (!rowTrimmed || !rowTrimmed.includes('|')) break;
        rows.push(splitTableRow(rowLine));
        index += 1;
      }
      blocks.push({ type: 'table', header, rows, aligns });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const current = lines[index].trim();
      if (
        !current ||
        current.startsWith('```') ||
        current.startsWith('>') ||
        /^[-*]\s+/.test(current) ||
        /^\d+\.\s+/.test(current) ||
        /^(#{1,3})\s+/.test(current) ||
        (current.includes('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1]))
      ) {
        break;
      }
      paragraphLines.push(lines[index].trim());
      index += 1;
    }

    blocks.push({ type: 'paragraph', text: paragraphLines.join(' ') });
  }

  return blocks;
}

export default function ControlledMarkdown({ content }: { content: string }) {
  const blocks = parseMarkdown(content);

  if (blocks.length === 0) {
    return <>{content}</>;
  }

  return (
    <div className="markdown-render">
      {blocks.map((block, index) => {
        const key = `block-${index}`;

        if (block.type === 'heading') {
          if (block.level === 1) return <h1 key={key}>{renderInline(block.text, key)}</h1>;
          if (block.level === 2) return <h2 key={key}>{renderInline(block.text, key)}</h2>;
          return <h3 key={key}>{renderInline(block.text, key)}</h3>;
        }

        if (block.type === 'paragraph') {
          return <p key={key}>{renderInline(block.text, key)}</p>;
        }

        if (block.type === 'blockquote') {
          return (
            <blockquote key={key}>
              {block.text.map((line, lineIndex) => (
                <p key={`${key}-quote-${lineIndex}`}>{renderInline(line, `${key}-quote-${lineIndex}`)}</p>
              ))}
            </blockquote>
          );
        }

        if (block.type === 'ul') {
          return (
            <ul key={key}>
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-ul-${itemIndex}`}>{renderInline(item, `${key}-ul-${itemIndex}`)}</li>
              ))}
            </ul>
          );
        }

        if (block.type === 'ol') {
          return (
            <ol key={key}>
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-ol-${itemIndex}`}>{renderInline(item, `${key}-ol-${itemIndex}`)}</li>
              ))}
            </ol>
          );
        }

        if (block.type === 'table') {
          return (
            <div key={key} className="markdown-table-wrap">
              <table className="markdown-table">
                <thead>
                  <tr>
                    {block.header.map((cell, cellIndex) => (
                      <th
                        key={`${key}-h-${cellIndex}`}
                        style={{ textAlign: block.aligns[cellIndex] ?? 'left' }}
                      >
                        {renderInline(cell, `${key}-h-${cellIndex}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={`${key}-r-${rowIndex}`}>
                      {row.map((cell, cellIndex) => (
                        <td
                          key={`${key}-r-${rowIndex}-c-${cellIndex}`}
                          style={{ textAlign: block.aligns[cellIndex] ?? 'left' }}
                        >
                          {renderInline(cell, `${key}-r-${rowIndex}-c-${cellIndex}`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        return (
          <pre key={key} className="markdown-code-block">
            <code data-language={block.language || undefined}>{block.code}</code>
          </pre>
        );
      })}
    </div>
  );
}
