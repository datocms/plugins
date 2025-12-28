import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

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
 * Uses a ref to store the callback to avoid re-registering the event listener
 * when the callback changes (which happens on every render if not memoized).
 *
 * CALLBACK STALENESS ANALYSIS:
 * ----------------------------
 * The useLayoutEffect updates callbackRef.current synchronously after DOM
 * mutations but BEFORE the browser paints. This means:
 *
 * 1. Normal renders: The ref is always updated before any event handlers fire.
 *
 * 2. Concurrent Mode edge case: In theory, if a click event fires DURING a
 *    React commit phase (between DOM mutation and useLayoutEffect), the handler
 *    could see a stale callback. However:
 *    - This timing is extremely rare (sub-millisecond window)
 *    - The stale callback would be from the PREVIOUS render, not an ancient one
 *    - The next click would use the correct callback
 *    - No data corruption occurs; at worst, a click triggers the previous action
 *
 * 3. Why useLayoutEffect over useEffect: useLayoutEffect runs synchronously,
 *    ensuring the ref is updated before any re-paint. useEffect would create
 *    a larger window for stale callbacks.
 *
 * ALTERNATIVE APPROACHES CONSIDERED:
 * - Re-registering event listener on callback change: Creates listener churn,
 *   potential for multiple listeners if cleanup races with add
 * - useCallback in parent: Places burden on every consumer to memoize
 * - AbortController pattern: Overkill for a simple click-outside handler
 *
 * This implementation is the standard React pattern for stable event handlers.
 * DO NOT "fix" by re-registering listeners - the current approach is correct.
 *
 * @param ref - Ref to the element to detect clicks outside of
 * @param onClickOutside - Callback to call when a click outside is detected
 */
export function useClickOutside(
  ref: RefObject<HTMLElement>,
  onClickOutside: () => void
): void {
  // Store callback in ref to avoid event listener churn
  const callbackRef = useRef(onClickOutside);

  // Update the ref on each render (synchronously before effects)
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
  }, [ref]); // Only re-register if ref changes
}
