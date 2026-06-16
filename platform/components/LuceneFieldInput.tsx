'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { AlertFieldDefinition } from '@/lib/alert-fields';

type LuceneFieldInputProps = {
  className?: string;
  fields: AlertFieldDefinition[];
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
};

type Suggestion = {
  insertText: string;
  key: string;
  label: string;
  name: string;
  type: string;
};

type AutocompleteContext = {
  fragment: string;
  hasColonSuffix: boolean;
  prefix: string;
  replaceEnd: number;
  start: number;
};

const RESERVED_TOKENS = new Set(['AND', 'OR', 'NOT']);

function isTokenBoundary(character: string) {
  return /\s/.test(character) || ['(', ')', '[', ']', '{', '}', ','].includes(character);
}

function isEscapedQuote(value: string, index: number) {
  let slashCount = 0;
  for (let position = index - 1; position >= 0 && value[position] === '\\'; position -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function isInsideQuotes(value: string, cursor: number) {
  let quoted = false;
  for (let position = 0; position < cursor; position += 1) {
    if (value[position] === '"' && !isEscapedQuote(value, position)) {
      quoted = !quoted;
    }
  }
  return quoted;
}

function getAutocompleteContext(value: string, cursor: number): AutocompleteContext | null {
  if (isInsideQuotes(value, cursor)) return null;

  let start = cursor;
  while (start > 0 && !isTokenBoundary(value[start - 1])) {
    start -= 1;
  }

  let end = cursor;
  while (end < value.length && !isTokenBoundary(value[end])) {
    end += 1;
  }

  const token = value.slice(start, end);
  const colonOffset = token.indexOf(':');
  if (colonOffset >= 0 && start + colonOffset < cursor) {
    return null;
  }

  const replaceEnd = colonOffset >= 0 ? start + colonOffset : end;
  const fieldToken = value.slice(start, replaceEnd);
  const match = fieldToken.match(/^([+\-!]?)([A-Za-z0-9_@.]*)$/);
  if (!match) return null;

  const [, prefix, fragment] = match;
  if (RESERVED_TOKENS.has(fragment.toUpperCase())) {
    return null;
  }

  return {
    fragment,
    hasColonSuffix: colonOffset >= 0,
    prefix,
    replaceEnd,
    start,
  };
}

function buildSuggestions(fields: AlertFieldDefinition[], fragment: string) {
  const normalized = fragment.trim().toLowerCase();
  const seen = new Set<string>();
  const suggestions: Array<Suggestion & { score: number }> = [];

  fields.forEach((field, index) => {
    if (!field.searchable) return;
    const insertText = field.queryField || field.name;
    if (!insertText || seen.has(insertText)) return;

    const lowerInsertText = insertText.toLowerCase();
    const lowerName = field.name.toLowerCase();
    const lowerLabel = field.label.toLowerCase();
    if (
      normalized &&
      !lowerInsertText.includes(normalized) &&
      !lowerName.includes(normalized) &&
      !lowerLabel.includes(normalized)
    ) {
      return;
    }

    seen.add(insertText);

    let score = index * 10;
    if (!normalized) score -= 1000;
    if (lowerInsertText === normalized || lowerName === normalized) score -= 500;
    else if (lowerInsertText.startsWith(normalized)) score -= 300;
    else if (lowerName.startsWith(normalized)) score -= 220;
    else if (lowerLabel.startsWith(normalized)) score -= 120;
    else if (lowerInsertText.includes(normalized)) score -= 80;
    else if (lowerName.includes(normalized)) score -= 60;

    suggestions.push({
      insertText,
      key: insertText,
      label: field.label,
      name: field.name,
      score,
      type: field.type,
    });
  });

  return suggestions
    .sort((left, right) => left.score - right.score || left.insertText.localeCompare(right.insertText))
    .slice(0, 8);
}

export default function LuceneFieldInput({
  className = '',
  fields,
  onChange,
  placeholder,
  value,
}: LuceneFieldInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCaretRef = useRef<number | null>(null);
  const listboxId = useId();
  const [activeIndex, setActiveIndex] = useState(0);
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);

  const context = useMemo(() => getAutocompleteContext(value, caret), [caret, value]);
  const suggestions = useMemo(
    () => buildSuggestions(fields, context?.fragment ?? ''),
    [context?.fragment, fields],
  );
  const open = focused && Boolean(context?.fragment.length) && suggestions.length > 0;

  useEffect(() => {
    setActiveIndex(0);
  }, [context?.fragment]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex((current) => Math.min(current, suggestions.length - 1));
  }, [open, suggestions.length]);

  useEffect(() => {
    if (pendingCaretRef.current === null) return;
    const nextCaret = pendingCaretRef.current;
    pendingCaretRef.current = null;
    inputRef.current?.focus();
    inputRef.current?.setSelectionRange(nextCaret, nextCaret);
    setCaret(nextCaret);
  }, [value]);

  useEffect(() => () => {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
  }, []);

  function syncCaretFromInput() {
    const nextCaret = inputRef.current?.selectionStart ?? value.length;
    setCaret(nextCaret);
  }

  function applySuggestion(insertText: string) {
    const currentCaret = inputRef.current?.selectionStart ?? caret;
    const currentContext = getAutocompleteContext(value, currentCaret);
    if (!currentContext) return;

    const replacement = `${currentContext.prefix}${insertText}`;
    const nextValue = `${value.slice(0, currentContext.start)}${replacement}${currentContext.hasColonSuffix ? '' : ':'}${value.slice(currentContext.replaceEnd)}`;
    const nextCaret = currentContext.start + replacement.length + (currentContext.hasColonSuffix ? 0 : 1);
    pendingCaretRef.current = nextCaret;
    onChange(nextValue);
    setFocused(true);
  }

  return (
    <div className={`lucene-field-input ${className}`.trim()}>
      <input
        ref={inputRef}
        aria-activedescendant={open ? `${listboxId}-${activeIndex}` : undefined}
        aria-autocomplete="list"
        aria-controls={open ? listboxId : undefined}
        aria-expanded={open}
        autoComplete="off"
        className="input alerts-query-input"
        onBlur={() => {
          blurTimerRef.current = setTimeout(() => setFocused(false), 120);
        }}
        onChange={(event) => {
          onChange(event.target.value);
          setCaret(event.target.selectionStart ?? event.target.value.length);
          setFocused(true);
        }}
        onClick={syncCaretFromInput}
        onFocus={() => {
          if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
          setFocused(true);
          syncCaretFromInput();
        }}
        onKeyDown={(event) => {
          if (!open) return;
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex((current) => (current + 1) % suggestions.length);
            return;
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
            return;
          }
          if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault();
            applySuggestion(suggestions[activeIndex].insertText);
            return;
          }
          if (event.key === 'Escape') {
            setFocused(false);
          }
        }}
        onKeyUp={syncCaretFromInput}
        placeholder={placeholder}
        role="combobox"
        spellCheck={false}
        value={value}
      />
      {open ? (
        <div className="lucene-field-suggestions" id={listboxId} role="listbox">
          {suggestions.map((suggestion, index) => {
            const meta = [suggestion.name !== suggestion.insertText ? suggestion.name : '', suggestion.label !== suggestion.insertText ? suggestion.label : '', suggestion.type]
              .filter(Boolean)
              .join(' / ');
            return (
              <button
                aria-selected={index === activeIndex}
                className={`lucene-field-suggestion ${index === activeIndex ? 'lucene-field-suggestion-active' : ''}`}
                id={`${listboxId}-${index}`}
                key={suggestion.key}
                onClick={() => applySuggestion(suggestion.insertText)}
                onMouseDown={(event) => event.preventDefault()}
                role="option"
                type="button"
              >
                <span className="lucene-field-suggestion-path">{suggestion.insertText}</span>
                {meta ? <span className="lucene-field-suggestion-meta">{meta}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
