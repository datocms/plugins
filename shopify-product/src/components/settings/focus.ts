import { type RefObject, useCallback, useLayoutEffect, useRef } from 'react';

/** Nothing useful has focus: the page itself, or an element that left it. */
export function isFocusLost(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || !active.isConnected;
}

/** The disabled reason of the buttons that check, save or change the stores. */
export const SAVING_REASON = 'Wait until the settings are saved.';

/**
 * A busy kit Button is natively disabled, so the browser drops its keyboard
 * focus to the page until the work ends. Call `follow()` when the button
 * starts its action: if the button had focus, focus goes back to it once
 * `busy` is over (or to `fallback` when the button is gone). It never takes
 * focus back from somewhere the user moved it meanwhile.
 */
export function useFocusAfterBusy(
  busy: boolean,
  fallback?: RefObject<HTMLElement | null>,
) {
  const ref = useRef<HTMLButtonElement>(null);
  const following = useRef(false);

  useLayoutEffect(() => {
    if (busy || !following.current) return;
    following.current = false;
    if (!isFocusLost()) return;
    const target = ref.current?.isConnected ? ref.current : fallback?.current;
    target?.focus({ preventScroll: true });
  });

  const follow = useCallback(() => {
    following.current =
      ref.current !== null && ref.current === document.activeElement;
  }, []);

  return { ref, follow };
}
