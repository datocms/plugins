// Always-on debug for troubleshooting in production builds
export function isDebugEnabled(): boolean { return true; }

export function dlog(...args: unknown[]) {
  // eslint-disable-next-line no-console
  console.log('[LocaleDuplicate]', ...args);
}

export function dgroup(label: string) {
  // eslint-disable-next-line no-console
  console.groupCollapsed(`[LocaleDuplicate] ${label}`);
}

export function dgroupEnd() {
  // eslint-disable-next-line no-console
  console.groupEnd();
}

// Produces a compact, shallow copy safe for console logging
export function compactValue<T = unknown>(value: T, depth = 2, arrayLimit = 5): unknown {
  const seen = new WeakSet();

  function inner(v: any, d: number): any {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return '[Circular]';
    seen.add(v);

    if (Array.isArray(v)) {
      const slice = v.slice(0, arrayLimit).map((x) => inner(x, d - 1));
      if (v.length > arrayLimit) slice.push(`… +${v.length - arrayLimit} more`);
      return slice;
    }

    if (d <= 0) {
      // Show key hints only
      return `{…keys: ${Object.keys(v).slice(0, 10).join(', ')}${Object.keys(v).length > 10 ? ', …' : ''}}`;
    }

    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      out[k] = inner(val, d - 1);
    }
    return out;
  }

  return inner(value as any, depth);
}
