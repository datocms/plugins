/** Clone JSON-like content without overflowing the call stack on nested blocks. */
export function cloneContent<T>(value: T): T {
  if (!value || typeof value !== 'object') return value;

  const createContainer = (source: object): Record<string, unknown> | unknown[] =>
    Array.isArray(source) ? [] : {};
  const root = createContainer(value);
  const clones = new WeakMap<object, Record<string, unknown> | unknown[]>();
  const active = new WeakSet<object>();
  clones.set(value, root);
  type Frame = {
    source: object;
    target: Record<string, unknown> | unknown[];
    entries: Array<[string, unknown]>;
    next: number;
  };
  const stack: Frame[] = [
    { source: value, target: root, entries: Object.entries(value), next: 0 },
  ];
  active.add(value);

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.next >= frame.entries.length) {
      active.delete(frame.source);
      stack.pop();
      continue;
    }
    const [key, entry] = frame.entries[frame.next++];
    if (!entry || typeof entry !== 'object') {
      Object.defineProperty(frame.target, key, {
        value: entry, enumerable: true, writable: true, configurable: true,
      });
      continue;
    }
    if (active.has(entry)) {
      throw new Error('Cannot translate circular content');
    }
    const existing = clones.get(entry);
    const target = existing ?? createContainer(entry);
    Object.defineProperty(frame.target, key, {
      value: target, enumerable: true, writable: true, configurable: true,
    });
    if (existing) continue;
    clones.set(entry, target);
    active.add(entry);
    stack.push({ source: entry, target, entries: Object.entries(entry), next: 0 });
  }
  return root as T;
}
