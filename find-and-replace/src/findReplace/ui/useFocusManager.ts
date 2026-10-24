import {
  type FocusEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import type { FindReplaceSnapshot } from '../contract';

/** Where a focus move can go (§6.9). `slot` is the primary or "Search again". */
export type FocusTarget = 'find' | 'slot' | 'stop';

/** A request whose target never shows up is dropped, so it can't steal the focus later. */
const REQUEST_TTL_MS = 2000;

type FocusRequest = {
  target: FocusTarget;
  requestedAt: number;
  /** Wait until the rendered snapshot satisfies this (events can arrive before the snapshot that goes with them). */
  when?: (snapshot: FindReplaceSnapshot) => boolean;
};

type FocusRefs = {
  /** The id of the Find input (the kit's inputs take no ref). */
  findId: string;
  /** The first button of the primary slot. */
  slot: RefObject<HTMLElement | null>;
  /** Stop, in the progress row. */
  stop: RefObject<HTMLElement | null>;
  /** The last rendered snapshot. */
  snapshot: RefObject<FindReplaceSnapshot>;
};

/** A control that swaps its element while keeping its place: the focus stays with it. */
type SwappingControl = 'slot' | 'stop';

function resolveTarget(
  target: FocusTarget,
  refs: FocusRefs,
): HTMLElement | null {
  switch (target) {
    case 'find':
      return document.getElementById(refs.findId);
    case 'slot': {
      // A busy primary can't take the focus: wait until it can.
      const element = refs.slot.current;
      return element && !element.matches(':disabled') ? element : null;
    }
    case 'stop':
      return refs.stop.current;
  }
}

/** The new element of a control that swapped its element, when it's still the same control. */
function swappedControl(
  control: SwappingControl | null,
  refs: FocusRefs,
): HTMLElement | null {
  switch (control) {
    case 'slot':
      return refs.snapshot.current.primary.kind === 'replace'
        ? resolveTarget('slot', refs)
        : null;
    case 'stop':
      return resolveTarget('stop', refs);
    default:
      return null;
  }
}

/**
 * Focus moves requested by events and clicks, applied as soon as their
 * target is rendered; and when the focused control unmounts for any other
 * reason, the focus goes back to the Find input.
 *
 * Two controls are exceptions: the primary, and Stop. A button that turns
 * disabled with a reason (or back) is drawn again as a new element. It's
 * still the same control, so the focus stays on it: the primary while it
 * stays the primary ("Search again" giving way to it is not the same
 * control), and Stop while the progress row shows ("Stop" → "Stopping…").
 */
export function useFocusManager(refs: FocusRefs) {
  // The refs and the id are stable, so the first object is kept.
  const refsRef = useRef(refs);
  const pendingRef = useRef<FocusRequest | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  /** The control the last focused element was, if it's one that swaps its element. */
  const lastControlRef = useRef<SwappingControl | null>(null);

  const applyPending = useCallback(() => {
    const request = pendingRef.current;
    const current = refsRef.current;
    if (!request) {
      return;
    }
    if (Date.now() - request.requestedAt > REQUEST_TTL_MS) {
      pendingRef.current = null;
      return;
    }
    if (request.when && !request.when(current.snapshot.current)) {
      return;
    }
    const element = resolveTarget(request.target, current);
    if (element) {
      pendingRef.current = null;
      element.focus();
    }
  }, []);

  const requestFocus = useCallback(
    (target: FocusTarget, when?: FocusRequest['when']) => {
      pendingRef.current = { target, when, requestedAt: Date.now() };
      applyPending();
    },
    [applyPending],
  );

  useEffect(() => {
    applyPending();
    const last = lastFocusedRef.current;
    const active = document.activeElement;
    if (
      last &&
      !last.isConnected &&
      (active === null || active === document.body)
    ) {
      lastFocusedRef.current = null;
      const current = refsRef.current;
      const same = swappedControl(lastControlRef.current, current);
      (same ?? resolveTarget('find', current))?.focus();
    }
  });

  /** Put on the page (React focus events bubble, portals included). */
  const onFocus = useCallback((event: FocusEvent<HTMLElement>) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    const current = refsRef.current;
    const target = event.target;
    lastFocusedRef.current = target;
    if (
      current.snapshot.current.primary.kind === 'replace' &&
      (current.slot.current?.contains(target) ?? false)
    ) {
      lastControlRef.current = 'slot';
    } else if (current.stop.current?.contains(target) ?? false) {
      lastControlRef.current = 'stop';
    } else {
      lastControlRef.current = null;
    }
  }, []);

  return { requestFocus, onFocus };
}
