// Always-on debug for troubleshooting in production builds
export function isDebugEnabled(): boolean {
  return true;
}

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

/**
 * Produces a compact representation of an array for console logging.
 */
function compactArray(
  arr: unknown[],
  depth: number,
  arrayLimit: number,
  seen: WeakSet<object>,
): unknown[] {
  const slice = arr
    .slice(0, arrayLimit)
    .map((x) => compactInner(x, depth - 1, arrayLimit, seen));
  if (arr.length > arrayLimit) {
    slice.push(`… +${arr.length - arrayLimit} more`);
  }
  return slice;
}

/**
 * Produces a compact representation of an object for console logging,
 * showing only key hints when the depth limit is reached.
 */
function compactObject(
  obj: Record<string, unknown>,
  depth: number,
  arrayLimit: number,
  seen: WeakSet<object>,
): unknown {
  if (depth <= 0) {
    const keys = Object.keys(obj);
    const visibleKeys = keys.slice(0, 10).join(', ');
    const overflow = keys.length > 10 ? ', …' : '';
    return `{…keys: ${visibleKeys}${overflow}}`;
  }

  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(obj)) {
    out[k] = compactInner(val, depth - 1, arrayLimit, seen);
  }
  return out;
}

/**
 * Inner recursive function for compactValue - handles circular reference detection.
 */
function compactInner(
  v: unknown,
  depth: number,
  arrayLimit: number,
  seen: WeakSet<object>,
): unknown {
  if (v === null || typeof v !== 'object') {
    return v;
  }

  if (seen.has(v)) {
    return '[Circular]';
  }
  seen.add(v);

  if (Array.isArray(v)) {
    return compactArray(v, depth, arrayLimit, seen);
  }

  return compactObject(v as Record<string, unknown>, depth, arrayLimit, seen);
}

// Produces a compact, shallow copy safe for console logging
export function compactValue<T = unknown>(
  value: T,
  depth = 2,
  arrayLimit = 5,
): unknown {
  const seen = new WeakSet<object>();
  return compactInner(value, depth, arrayLimit, seen);
}
