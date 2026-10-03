import { describe, expect, it } from 'vitest';
import { cloneContent } from './ContentIntegrity';

describe('cloneContent', () => {
  it('clones a 20,000-level synthetic tree without recursive stack growth', () => {
    const root: Record<string, unknown> = {};
    let source = root;
    for (let index = 0; index < 20_000; index++) {
      const child: Record<string, unknown> = { id: `reference-${index}` };
      source.child = child;
      source = child;
    }
    source.value = 'leaf';
    const cloned = cloneContent(root);
    let target = cloned;
    let original = root;
    for (let index = 0; index < 20_000; index++) {
      // Object matchers inspect deep equality for diagnostic hints; compare
      // identity as a boolean so the assertion itself stays iterative.
      expect(target === original).toBe(false);
      target = target.child as Record<string, unknown>;
      original = original.child as Record<string, unknown>;
    }
    expect(target.value).toBe('leaf');
    expect(target.id).toBe('reference-19999');
  });

  it('rejects a cycle, while preserving aliases and literal metadata keys', () => {
    const shared = { id: 'keep-reference' };
    const source = JSON.parse('{"__proto__":{"id":"keep-metadata"}}') as Record<string, unknown>;
    source.first = shared;
    source.second = shared;
    const clone = cloneContent(source);
    expect(clone.first).toBe(clone.second);
    expect(clone.first).not.toBe(shared);
    expect(Object.hasOwn(clone, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(clone)).toBe(Object.prototype);
    source.cycle = source;
    expect(() => cloneContent(source)).toThrow('Cannot translate circular content');
  });
});
