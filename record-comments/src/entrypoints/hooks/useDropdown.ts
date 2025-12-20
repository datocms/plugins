import { useEffect, type RefObject } from 'react';

/**
 * Hook that scrolls the currently selected element into view.
 * @param selectedRef - Ref to the selected element
 * @param selectedIndex - Current selection index (triggers scroll on change)
 */
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

/**
 * Hook that detects clicks outside a referenced element and calls a callback.
 * @param ref - Ref to the element to detect clicks outside of
 * @param onClickOutside - Callback to call when a click outside is detected
 */
export function useClickOutside(
  ref: RefObject<HTMLElement>,
  onClickOutside: () => void
): void {
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClickOutside();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClickOutside]);
}







