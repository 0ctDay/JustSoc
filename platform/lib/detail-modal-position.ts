import { useCallback, useLayoutEffect, useState, type CSSProperties } from 'react';

const TOP_MARGIN = 20;
const VISUAL_CENTER_OFFSET = -40;

export function useClickCenteredModalPosition(
  open: boolean,
  _centerY: number | null,
  baseStyle: CSSProperties = {},
  _debugName = 'detail',
) {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [top, setTop] = useState(TOP_MARGIN);

  const updateTop = useCallback(() => {
    if (!open || typeof window === 'undefined') return;
    const viewportHeight = window.innerHeight;
    const scrollY = window.scrollY;
    const pageHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, viewportHeight);
    const fallbackHeight = Math.min(viewportHeight - 32, viewportHeight * 0.8);
    const modalHeight = node?.getBoundingClientRect().height || fallbackHeight;
    const targetY = scrollY + viewportHeight / 2 + VISUAL_CENTER_OFFSET;
    const rawTop = targetY - modalHeight / 2;
    const maxTop = Math.max(TOP_MARGIN, pageHeight - modalHeight - TOP_MARGIN);
    const nextTop = Math.min(Math.max(TOP_MARGIN, rawTop), maxTop);
    setTop(nextTop);
  }, [node, open]);

  useLayoutEffect(() => {
    updateTop();
    if (!open) return undefined;
    window.addEventListener('resize', updateTop);
    const observer = node && 'ResizeObserver' in window ? new ResizeObserver(updateTop) : null;
    if (node) observer?.observe(node);
    return () => {
      window.removeEventListener('resize', updateTop);
      observer?.disconnect();
    };
  }, [node, open, updateTop]);

  return {
    modalRef: setNode,
    modalStyle: {
      ...baseStyle,
      position: 'absolute',
      top: `${top}px`,
      left: '50%',
      translate: '-50% 0',
    } satisfies CSSProperties,
  };
}
