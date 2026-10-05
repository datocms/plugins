import { type RefObject, useEffect, useState } from 'react';

/** The number of columns a CSS grid currently lays out (1 when unknown). */
export function gridColumnCount(element: Element | null): number {
  if (!element) return 1;
  const template = window.getComputedStyle(element).gridTemplateColumns;
  if (!template || template === 'none') return 1;
  return Math.max(1, template.split(' ').filter(Boolean).length);
}

/** Tracks `gridColumnCount` as the grid resizes. */
export function useGridColumns(
  grid: RefObject<HTMLElement | null>,
  enabled: boolean,
): number {
  const [columns, setColumns] = useState(1);

  useEffect(() => {
    const element = grid.current;
    if (!enabled || !element) {
      setColumns(1);
      return undefined;
    }
    const measure = () => setColumns(gridColumnCount(element));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [grid, enabled]);

  return columns;
}
