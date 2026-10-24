/**
 * retryFocus.ts
 * -------------
 * Keyboard focus through a "Try again" that a loading state replaces, and
 * through a busy button. When the focused button unmounts or turns disabled
 * (a busy kit Button is disabled), the browser drops the focus to the body,
 * and a keyboard or screen-reader user would start again from the top of
 * the frame. These helpers keep the focus where the user was: on a holder
 * while the retry runs, then on the control that the settled state shows.
 */
import { useCallback, useLayoutEffect, useRef } from 'react';

/** Nothing useful has the focus: the page itself, or an element that left it. */
export function isFocusLost(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || !active.isConnected;
}

/** The focus is lost, or on the element that holds it for a retry. */
function focusIsFree(holder: HTMLElement | null): boolean {
  return (
    isFocusLost() || (holder !== null && document.activeElement === holder)
  );
}

/**
 * Focuses an element that isn't a control (the layout box of a page, the
 * box of a field), as the kit's `Main` does on a route change: the element
 * takes `tabindex="-1"` for as long as it has the focus.
 */
export function holdFocus(element: HTMLElement): void {
  if (element.hasAttribute('tabindex')) {
    element.focus({ preventScroll: true });
    return;
  }
  element.setAttribute('tabindex', '-1');
  element.focus({ preventScroll: true });
  if (document.activeElement !== element) {
    element.removeAttribute('tabindex');
    return;
  }
  element.addEventListener('blur', () => element.removeAttribute('tabindex'), {
    once: true,
  });
}

/**
 * Keeps the focus through a retry. The "Try again" handler calls the
 * returned function before it retries. While `phase` is `loadingPhase`, the
 * `holder` holds the focus; once the phase settles, `target(phase)` takes it
 * (the new "Try again" after another failure, the first control of what
 * loaded), else the holder keeps it. The focus moves only when it is lost or
 * on the holder, never away from where the user put it meanwhile.
 *
 * @param phase - The state of the area, as a string.
 * @param loadingPhase - The phase while the retry runs.
 * @param holder - The element that holds the focus while the retry runs.
 * @param target - The control that takes the focus in a settled phase.
 * @returns The function that the "Try again" handler calls first.
 */
export function useRetryFocus<Phase extends string>(
  phase: Phase,
  loadingPhase: Phase,
  holder: () => HTMLElement | null,
  target: (settled: Phase) => HTMLElement | null,
): () => void {
  const following = useRef(false);
  const holderRef = useRef(holder);
  const targetRef = useRef(target);

  useLayoutEffect(() => {
    holderRef.current = holder;
    targetRef.current = target;
  });

  useLayoutEffect(() => {
    if (!following.current) return;
    const held = holderRef.current();
    const loading = phase === loadingPhase;
    // A settled phase ends the retry, wherever the focus is.
    if (!loading) following.current = false;
    if (!focusIsFree(held)) return;
    const next = loading ? held : (targetRef.current(phase) ?? held);
    if (next === held) {
      if (held) holdFocus(held);
    } else {
      next?.focus({ preventScroll: true });
    }
  }, [phase, loadingPhase]);

  return useCallback(() => {
    following.current = true;
  }, []);
}

/**
 * Where a busy action is: `armed` from its start until the button turns
 * busy, `running` while it is busy, and `settled` once the focus came back,
 * while the button may still turn into a new element.
 */
type BusyFocusStage = 'idle' | 'armed' | 'running' | 'settled';

/**
 * Gives the focus back after a busy action. A busy kit Button is disabled,
 * and a disabled button drops the focus to the body. The action calls the
 * returned function when it starts, in the same event that makes `busy`
 * true. In the commit where `busy` is false again, `target()` takes the
 * focus: the button when it is still enabled or disabled with a reason
 * (that keeps the focus), else the next sensible control. It moves only
 * when nothing has the focus, never away from where the user put it
 * meanwhile.
 *
 * A kit Button that gains or loses a disabled reason renders a new element,
 * which drops the focus again. `shape` names that state of the target (its
 * reason): when it changes once more after the settle, as when the host's
 * update after a save turns Save off, the new element takes the focus too.
 *
 * @param busy - The action runs.
 * @param target - The control that takes the focus once the action ends.
 * @param shape - The state of the target that renders it as a new element.
 * @returns The function that the action calls when it starts.
 */
export function useBusyFocus(
  busy: boolean,
  target: () => HTMLElement | null,
  shape?: string,
): () => void {
  const stage = useRef<BusyFocusStage>('idle');
  const targetRef = useRef(target);

  useLayoutEffect(() => {
    targetRef.current = target;
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: `shape` re-runs the check when the target becomes a new element.
  useLayoutEffect(() => {
    if (busy) {
      if (stage.current === 'armed') stage.current = 'running';
      return;
    }
    const current = stage.current;
    stage.current = 'idle';
    // Only an action that was busy, or that just gave the focus back; and
    // only when the user didn't put the focus somewhere meanwhile.
    if (current !== 'running' && current !== 'settled') return;
    if (!isFocusLost()) return;
    const element = targetRef.current();
    element?.focus({ preventScroll: true });
    // Right after the settle, the target may still become a new element.
    if (current === 'running' && element && document.activeElement === element)
      stage.current = 'settled';
  }, [busy, shape]);

  return useCallback(() => {
    stage.current = 'armed';
  }, []);
}
