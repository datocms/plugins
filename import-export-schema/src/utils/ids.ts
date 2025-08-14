export function asIdString<T extends { id: string | number }>(e: T): T {
  return { ...e, id: String(e.id) } as T;
}

export function mapById<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((e) => [e.id, e]));
}

export function requireMap<K, V>(map: Map<K, V>, key: K, ctx: string): V {
  const value = map.get(key);
  if (value === undefined) throw new Error(`Missing ${String(key)} in ${ctx}`);
  return value;
}
