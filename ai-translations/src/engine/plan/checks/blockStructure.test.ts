import { describe, expect, it } from 'vitest';
import { blockSignatureOf, checkBlockStructure } from './blockStructure';

const block = (id: string, children: unknown[] = []) => ({
  type: 'item', id, attributes: {}, relationships: { children: { data: children } },
});

describe('blockSignatureOf', () => {
  it('counts top-level blocks in an array', () => {
    expect(blockSignatureOf([block('a'), block('b')])).toEqual({ count: 2, children: [] });
  });
  it('recurses into nested block arrays', () => {
    const value = [block('a', [block('a1'), block('a2')])];
    const sig = blockSignatureOf(value);
    expect(sig.count).toBe(1);
    expect(sig.children[0].count).toBe(2);
  });
  it('returns a zero signature for a non-block value', () => {
    expect(blockSignatureOf('hello')).toEqual({ count: 0, children: [] });
  });
});

describe('checkBlockStructure', () => {
  it('passes when counts and nesting match', () => {
    const expected = blockSignatureOf([block('a'), block('b')]);
    expect(checkBlockStructure({ value: [block('x'), block('y')], expected })).toBeNull();
  });
  it('flags a dropped block', () => {
    const expected = blockSignatureOf([block('a'), block('b')]);
    const flag = checkBlockStructure({ value: [block('x')], expected, fieldPath: 'body', locale: 'it' });
    expect(flag?.checkId).toBe('block-structure');
    expect(flag?.severity).toBe('error');
  });
});
