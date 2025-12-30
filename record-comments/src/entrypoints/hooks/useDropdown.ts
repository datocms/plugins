import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

export function useScrollSelectedIntoView(
  selectedRef: RefObject<HTMLElement>,
  selectedIndex: number
): void {
  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    }
  }, [selectedIndex]);
}

export function useClickOutside(
  ref: RefObject<HTMLElement>,
  onClickOutside: () => void
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

