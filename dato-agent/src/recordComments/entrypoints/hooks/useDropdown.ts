import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react';

export function useScrollSelectedIntoView(
  selectedRef: RefObject<HTMLElement | null>,
  selectedIndex: number,
): void {
  useEffect(() => {
    if (selectedIndex < 0) return;

    if (
      selectedRef.current &&
      typeof selectedRef.current.scrollIntoView === 'function'
    ) {
      selectedRef.current.scrollIntoView({
        block: 'nearest',
      });
    }
  }, [selectedIndex, selectedRef]);
}

export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  onClickOutside: () => void,
): void {
  const callbackRef = useRef(onClickOutside);

  useLayoutEffect(() => {
    callbackRef.current = onClickOutside;
  });

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        callbackRef.current();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [ref]);
}
