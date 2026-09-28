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
  find: RefObject<HTMLInputElement | null>;
  slot: RefObject<HTMLElement | null>;
  progress: RefObject<HTMLElement | null>;
  /** The last rendered snapshot. */
  snapshot: RefObject<FindReplaceSnapshot>;
};

function resolveTarget(
  target: FocusTarget,
  refs: FocusRefs,
): HTMLElement | null {
  switch (target) {
    case 'find':
      return refs.find.current;
    case 'slot':
      // A disabled primary is reached through its tooltip anchor.
      return (
        refs.slot.current?.querySelector<HTMLElement>(
          '.dl-tooltip-anchor, button:not(:disabled)',
        ) ?? null
      );
    case 'stop':
      return (
        refs.progress.current?.querySelector<HTMLElement>('button') ?? null
      );
  }
}

/**
 * Focus moves requested by events and clicks, applied as soon as their target
 * is rendered; and when the focused control unmounts for any other reason,
 * the focus goes back to the Find input. One exception: the primary swaps
 * its element when it turns enabled or disabled (a button, or a focusable
 * anchor around the disabled one); that is still the same control, so the
 * focus stays on it. ("Search again" giving way to the primary is not.)
 */
export function useFocusManager(refs: FocusRefs) {
  // The refs themselves are stable, so the first object is kept.
  const refsRef = useRef(refs);
  const pendingRef = useRef<FocusRequest | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  /** The last focused element was the primary ("Replace …", enabled or not). */
  const lastOnPrimaryRef = useRef(false);

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
      const primary =
        lastOnPrimaryRef.current &&
        current.snapshot.current.primary.kind === 'replace'
          ? resolveTarget('slot', current)
          : null;
      (primary ?? current.find.current)?.focus();
    }
  });

  /** Put on the pane (React focus events bubble, portals included). */
  const onFocus = useCallback((event: FocusEvent<HTMLElement>) => {
    if (event.target instanceof HTMLElement) {
      const current = refsRef.current;
      lastFocusedRef.current = event.target;
      lastOnPrimaryRef.current =
        current.snapshot.current.primary.kind === 'replace' &&
        (current.slot.current?.contains(event.target) ?? false);
    }
  }, []);

  return { requestFocus, onFocus };
}
