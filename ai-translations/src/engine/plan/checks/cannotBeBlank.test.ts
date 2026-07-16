import { describe, expect, it } from 'vitest';
import { checkCannotBeBlank } from './cannotBeBlank';

describe('checkCannotBeBlank', () => {
  it('passes a non-blank value', () => {
    expect(checkCannotBeBlank({ value: 'Ciao', cannotBeBlank: true })).toBeNull();
  });
  it('ignores fields that may be blank', () => {
    expect(checkCannotBeBlank({ value: '', cannotBeBlank: false })).toBeNull();
  });
  it('flags an empty string on a cannot-be-blank field', () => {
    const flag = checkCannotBeBlank({ value: '   ', cannotBeBlank: true, fieldPath: 'title', locale: 'it' });
    expect(flag?.checkId).toBe('cannot-be-blank');
    expect(flag?.severity).toBe('error');
    expect(flag?.fieldPath).toBe('title');
  });
  it('flags null, undefined, empty array, and empty object', () => {
    for (const value of [null, undefined, [], {}]) {
      expect(checkCannotBeBlank({ value, cannotBeBlank: true })?.severity).toBe('error');
    }
  });
});
