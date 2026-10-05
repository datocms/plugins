import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

/**
 * Where focus goes when the control an editor used disappears:
 * - `{ index }`: the row at that position (its ⋮ trigger, else its first
 *   focusable element);
 * - `'first-row'`: the first row;
 * - `'add'`, `'browse'`: the "Add …" and "Browse Shopify" buttons.
 * Targets are tried in order; missing ones are skipped.
 */
export type FocusTarget = { index: number } | 'first-row' | 'add' | 'browse';

export type FieldFeedback = {
  /**
   * Starts watching for focus loss on behalf of an action and returns its
   * token. Until the action is settled, and for a moment after (the host
   * re-renders the field once the value is saved), focus that falls to
   * `<body>` moves to the first target that exists.
   */
  expect: (targets: FocusTarget[]) => number;
  /** Changes the targets of the latest action, once it knows more. */
  refine: (targets: FocusTarget[]) => void;
  /** The action with this token settled. */
  settle: (token: number) => void;
  /** Tells screen readers what an action did (a `role="status"` region). */
  announce: (message: string) => void;
};

/** How long after an action settles focus is still looked after. */
const SETTLE_GRACE_MS = 3000;

/** Marks a row's outer element (the value is the row's key). */
export const ROW_ATTRIBUTE = 'data-entry-row';
/** Marks the element inside a row that takes focus (the ⋮ trigger). */
export const ROW_FOCUS_ATTRIBUTE = 'data-row-focus';
/** Marks the wrapper of a field-level button: `add` or `browse`. */
export const FIELD_ACTION_ATTRIBUTE = 'data-field-action';

type Intent = { token: number; targets: FocusTarget[]; until: number };

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

function isDisabled(element: Element): boolean {
  return element instanceof HTMLButtonElement && element.disabled;
}

function rowFocusTarget(row: Element | undefined): HTMLElement | null {
  if (!row) return null;
  return (
    row.querySelector<HTMLElement>(`[${ROW_FOCUS_ATTRIBUTE}]`) ??
    row.querySelector<HTMLElement>(FOCUSABLE)
  );
}

function findTarget(
  root: HTMLElement,
  target: FocusTarget,
): HTMLElement | null {
  if (target === 'add' || target === 'browse') {
    return root.querySelector<HTMLElement>(
      `[${FIELD_ACTION_ATTRIBUTE}="${target}"] button:not([disabled])`,
    );
  }
  const rows = root.querySelectorAll(`[${ROW_ATTRIBUTE}]`);
  const index = target === 'first-row' ? 0 : target.index;
  return index >= 0 ? rowFocusTarget(rows[index]) : null;
}

function focusFirst(root: HTMLElement, targets: readonly FocusTarget[]) {
  for (const target of targets) {
    const element = findTarget(root, target);
    if (element) {
      element.focus({ preventScroll: true });
      return;
    }
  }
}

/** Focus fell out of the field: the focused element was removed or disabled. */
function focusWasLost(lost: HTMLElement | null): boolean {
  if (!lost || (lost.isConnected && !isDisabled(lost))) return false;
  const active = document.activeElement;
  return active === null || active === document.body || active === lost;
}

/**
 * Keeps keyboard and screen-reader users in place after editor actions.
 * Removing a row, replacing it, saving from the empty state or a notice
 * unmounts the control that was used; focus would fall to `<body>`. While an
 * action runs (see `expect`), this moves it to a sensible neighbor instead,
 * and `announce` says what changed. Nothing moves focus outside an action.
 */
export function useFieldFeedback(): {
  rootRef: RefObject<HTMLDivElement | null>;
  feedback: FieldFeedback;
  message: string;
} {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const intent = useRef<Intent | null>(null);
  const lastFocused = useRef<HTMLElement | null>(null);
  const nextToken = useRef(0);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement)
        lastFocused.current = event.target;
    };
    const rescue = () => {
      const current = intent.current;
      if (!current) return;
      if (Date.now() > current.until) {
        intent.current = null;
        return;
      }
      if (focusWasLost(lastFocused.current)) focusFirst(root, current.targets);
    };
    const observer = new MutationObserver(rescue);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled'],
    });
    root.addEventListener('focusin', onFocusIn);
    return () => {
      observer.disconnect();
      root.removeEventListener('focusin', onFocusIn);
    };
  }, []);

  const expect = useCallback((targets: FocusTarget[]) => {
    // Browsers skip focus events while the window isn't focused.
    const active = document.activeElement;
    if (active instanceof HTMLElement && rootRef.current?.contains(active)) {
      lastFocused.current = active;
    }
    nextToken.current += 1;
    intent.current = {
      token: nextToken.current,
      targets,
      until: Number.POSITIVE_INFINITY,
    };
    return nextToken.current;
  }, []);

  const refine = useCallback((targets: FocusTarget[]) => {
    if (intent.current) intent.current = { ...intent.current, targets };
  }, []);

  const settle = useCallback((token: number) => {
    const current = intent.current;
    if (current?.token === token) {
      intent.current = { ...current, until: Date.now() + SETTLE_GRACE_MS };
    }
  }, []);

  const announce = useCallback((text: string) => setMessage(text), []);

  const feedback = useMemo(
    () => ({ expect, refine, settle, announce }),
    [expect, refine, settle, announce],
  );
  return { rootRef, feedback, message };
}
