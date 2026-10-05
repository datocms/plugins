import { describe, expect, it } from 'vitest';
import { cloneContent } from './ContentIntegrity';

describe('cloneContent', () => {
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
