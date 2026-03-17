function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

export function stableClone<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => stableClone(entry)) as T;
  }

  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};

    for (const key of Object.keys(value).sort()) {
      result[key] = stableClone(value[key]);
    }

    return result as T;
  }

  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stableClone(value));
}

export function deepEqual(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right);
}

export function prettyJson(value: unknown): string {
  return JSON.stringify(stableClone(value), null, 2);
}
