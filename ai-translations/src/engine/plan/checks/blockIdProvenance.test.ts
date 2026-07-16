import { describe, expect, it } from 'vitest';
import { checkBlockIdProvenance } from './blockIdProvenance';

const block = (id: string | undefined, children: unknown[] = []) => ({
  type: 'item',
  ...(id !== undefined ? { id } : {}),
  attributes: {},
  relationships: { children: { data: children } },
});

describe('checkBlockIdProvenance', () => {
  it('passes when target blocks carry no id (freshly rebuilt)', () => {
    expect(
      checkBlockIdProvenance({
        sourceValue: [block('src-1'), block('src-2')],
        targetValue: [block(undefined), block(undefined)],
      }),
    ).toBeNull();
  });

  it('flags a source id that survived into the target', () => {
    const flag = checkBlockIdProvenance({
      sourceValue: [block('src-1')],
      targetValue: [block('src-1')],
      fieldPath: 'body',
      locale: 'it',
    });
    expect(flag?.checkId).toBe('block-id-provenance');
    expect(flag?.severity).toBe('error');
    expect(flag?.message).toContain('src-1');
  });

  it('detects a leak nested inside a child block', () => {
    const flag = checkBlockIdProvenance({
      sourceValue: [block('outer', [block('inner')])],
      targetValue: [block(undefined, [block('inner')])],
    });
    expect(flag?.severity).toBe('error');
  });

  it('passes when the field has no blocks at all', () => {
    expect(checkBlockIdProvenance({ sourceValue: 'text', targetValue: 'testo' })).toBeNull();
  });

  it('passes when target introduces its own new ids not from the source', () => {
    expect(
      checkBlockIdProvenance({
        sourceValue: [block('src-1')],
        targetValue: [block('brand-new')],
      }),
    ).toBeNull();
  });
});
