/** Stable keys prevent duplicate archives when response object order changes. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry))
      return entry;
    const ordered: Record<string, unknown> = {};
    for (const key of Object.keys(entry).sort()) {
      Object.defineProperty(ordered, key, {
        value: (entry as Record<string, unknown>)[key],
        enumerable: true,
      });
    }
    return ordered;
  });
}
