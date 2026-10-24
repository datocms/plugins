import { useCallback, useEffect, useRef } from 'react';

/**
 * Runs a callback once the pointer press in progress ends (after its click),
 * or at once when no press is in progress. A press on a button blurs the
 * editor: when the toolbar hides at that moment, everything under it moves
 * up, and the button moves away from the pointer before the click lands.
 */
export function useAfterPointerRelease() {
  const pressedRef = useRef(false);
  const pendingRef = useRef<(() => void) | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleDown = () => {
      pressedRef.current = true;
    };
    const handleUp = () => {
      pressedRef.current = false;
      const pending = pendingRef.current;
      pendingRef.current = null;
      // The next task: the click of this press is already dispatched
      if (pending) timeoutRef.current = setTimeout(pending, 0);
    };

    document.addEventListener('pointerdown', handleDown, true);
    document.addEventListener('pointerup', handleUp, true);
    document.addEventListener('pointercancel', handleUp, true);
    return () => {
      document.removeEventListener('pointerdown', handleDown, true);
      document.removeEventListener('pointerup', handleUp, true);
      document.removeEventListener('pointercancel', handleUp, true);
      pendingRef.current = null;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return useCallback((callback: () => void) => {
    if (pressedRef.current) {
      pendingRef.current = callback;
    } else {
      callback();
    }
  }, []);
}
