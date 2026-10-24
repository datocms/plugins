import type { Mention } from '../../lib/mentions';

/** Two references to the same thing (and locale) share this identity */
export function mentionIdentity(mention: Mention) {
  return mention.type === 'field'
    ? `${mention.type}:${mention.fieldPath}:${mention.locale ?? ''}`
    : `${mention.type}:${mention.id}`;
}

/**
 * Pairs each value with a React key built from its identity. A value that
 * shows more than once gets the number of the occurrence, so the keys stay
 * unique and stable while the list grows.
 */
export function withStableKeys<T>(
  values: readonly T[],
  identity: (value: T) => string,
) {
  const occurrences = new Map<string, number>();
  const keyed: Array<{ key: string; value: T }> = [];
  for (const value of values) {
    const base = identity(value);
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    keyed.push({ key: `${base}:${occurrence}`, value });
  }
  return keyed;
}
