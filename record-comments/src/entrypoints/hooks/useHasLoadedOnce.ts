import { useEffect, useRef, useState } from 'react';

/**
 * Tells whether the data of the current scope (an environment, a model and a
 * record) loaded at least once. It stays true for the scope through the later
 * loads, and starts again from false when the scope changes.
 *
 * The data hooks reset their state in an effect of the commit that brings a
 * new scope, thus the values of that render still belong to the previous
 * scope: they never mark the new one as loaded. The reset renders again with
 * the values of the new scope.
 */
export function useHasLoadedOnce(scopeKey: string, settled: boolean): boolean {
  const [loadedScopeKey, setLoadedScopeKey] = useState<string | null>(null);
  const committedScopeKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const previousScopeKey = committedScopeKeyRef.current;
    committedScopeKeyRef.current = scopeKey;

    if (previousScopeKey !== null && previousScopeKey !== scopeKey) return;
    if (settled) setLoadedScopeKey(scopeKey);
  });

  return loadedScopeKey === scopeKey;
}

/**
 * How many times the value changed (by identity) since the first render: 0,
 * then 1, 2… It gives a part of a scope key for a value that is not a string,
 * for example a client that a data hook loads again with.
 */
export function useChangeCount(value: unknown): number {
  const [state, setState] = useState({ value, count: 0 });

  if (state.value === value) return state.count;

  // The state of the previous renders: React renders again at once
  const count = state.count + 1;
  setState({ value, count });
  return count;
}
