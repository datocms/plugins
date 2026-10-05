import { type ReactNode, useLayoutEffect } from 'react';

/** Joins the ids that are set into an `aria-describedby` value. */
export function describedBy(
  ...ids: Array<string | false | null | undefined>
): string | undefined {
  const joined = ids.filter(Boolean).join(' ');
  return joined || undefined;
}

export type Described = {
  /** The hint, wrapped in a span with its id. */
  hint: ReactNode;
  /** The error, wrapped in a span with its id. */
  error: ReactNode;
  /** The error's id, then the hint's (`undefined` without either). */
  ids: string | undefined;
  invalid: true | undefined;
};

/**
 * The kit's fields render `hint` and `error` without ids and never point the
 * control at them, so screen readers don't hear either. This gives both an id
 * (`<id>-error`, `<id>-hint`) and returns what the control needs, like the
 * plugin settings' store fields do.
 */
export function describe(
  id: string,
  hint: ReactNode,
  error: string | undefined,
): Described {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return {
    hint: hint ? <span id={hintId}>{hint}</span> : undefined,
    error: error ? <span id={errorId}>{error}</span> : undefined,
    ids: describedBy(error && errorId, hint ? hintId : undefined),
    invalid: error ? true : undefined,
  };
}

function idList(value: string | null): string[] {
  return (value ?? '').split(/\s+/).filter(Boolean);
}

/**
 * react-select owns its input's `aria-describedby` (its placeholder, or its
 * live region) and has no prop to extend it. This puts `ids` first in it, and
 * again whenever react-select rewrites the attribute.
 */
export function useInputDescription(
  inputId: string,
  ids: string | undefined,
): void {
  useLayoutEffect(() => {
    const own = idList(ids ?? null);
    const input = document.getElementById(inputId);
    if (!input || own.length === 0) return undefined;
    const apply = () => {
      const current = idList(input.getAttribute('aria-describedby'));
      const others = current.filter((id) => !own.includes(id));
      const next = [...own, ...others].join(' ');
      if (next !== current.join(' ')) {
        input.setAttribute('aria-describedby', next);
      }
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(input, {
      attributes: true,
      attributeFilter: ['aria-describedby'],
    });
    return () => {
      observer.disconnect();
      const rest = idList(input.getAttribute('aria-describedby')).filter(
        (id) => !own.includes(id),
      );
      if (rest.length > 0) {
        input.setAttribute('aria-describedby', rest.join(' '));
      } else {
        input.removeAttribute('aria-describedby');
      }
    };
  }, [inputId, ids]);
}
