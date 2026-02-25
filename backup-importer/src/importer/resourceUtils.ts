import type { JsonObject } from './types';

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function asBoolean(value: unknown): boolean {
  return Boolean(value);
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asObject(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}

export function extractEntityId(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }

  if (!isObject(value)) {
    return null;
  }

  return asString(value.id);
}

export function cloneJson<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

export function deepRemapKnownIds(
  value: unknown,
  idMaps: Array<Map<string, string>>,
): unknown {
  const mapLookup = new Map<string, string>();
  idMaps.forEach((idMap) => {
    idMap.forEach((targetId, sourceId) => {
      mapLookup.set(sourceId, targetId);
    });
  });

  const visited = new WeakSet<object>();

  function walk(node: unknown): unknown {
    if (typeof node === 'string') {
      return mapLookup.get(node) ?? node;
    }

    if (Array.isArray(node)) {
      return node.map((entry) => walk(entry));
    }

    if (!isObject(node)) {
      return node;
    }

    if (visited.has(node)) {
      return node;
    }
    visited.add(node);

    const result: JsonObject = {};
    for (const [key, nestedValue] of Object.entries(node)) {
      if (key === 'id' && typeof nestedValue === 'string') {
        result[key] = mapLookup.get(nestedValue) ?? nestedValue;
        continue;
      }

      result[key] = walk(nestedValue);
    }

    return result;
  }

  return walk(value);
}

export function makeCompositeKey(parts: Array<string | number | boolean | null>) {
  return parts.map((part) => String(part ?? '')).join('::');
}

export function compactObject(input: JsonObject): JsonObject {
  const result: JsonObject = {};

  Object.entries(input).forEach(([key, value]) => {
    if (typeof value === 'undefined') {
      return;
    }
    result[key] = value;
  });

  return result;
}
