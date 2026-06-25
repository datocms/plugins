/**
 * Tests for checkFieldLength — the proactive guard against a translated value
 * overflowing a DatoCMS string-length validator. This is the QC half of the
 * reported "silently failed and truncated the record … hit the character limit
 * for the field" bug: translations that grow past a field's `length.max` are
 * flagged BEFORE the user saves (sidebar) or before the bulk write 422s, naming
 * the field and the limit instead of failing opaquely.
 */

import { describe, expect, it } from 'vitest';
import type { FieldValidators } from '../SharedFieldUtils';
import { checkFieldLength } from './validatorChecks';

const lengthMax = (max: number): FieldValidators =>
  ({ length: { max } }) as unknown as FieldValidators;

describe('checkFieldLength', () => {
  it('returns null when there are no validators', () => {
    expect(
      checkFieldLength({ value: 'anything', validators: undefined }),
    ).toBeNull();
  });

  it('returns null when there is no length validator', () => {
    expect(
      checkFieldLength({
        value: 'anything',
        validators: { required: {} } as unknown as FieldValidators,
      }),
    ).toBeNull();
  });

  it('returns null when the value is within the max length', () => {
    expect(
      checkFieldLength({ value: 'hello', validators: lengthMax(10) }),
    ).toBeNull();
  });

  it('returns null at exactly the max length (boundary)', () => {
    expect(
      checkFieldLength({ value: '12345', validators: lengthMax(5) }),
    ).toBeNull();
  });

  it('flags an error when the value exceeds the max length', () => {
    const flag = checkFieldLength({
      value: 'abcdef',
      validators: lengthMax(5),
      fieldPath: 'summary',
      locale: 'fr',
    });
    expect(flag).toMatchObject({
      checkId: 'length-validator',
      severity: 'error',
      fieldPath: 'summary',
      locale: 'fr',
    });
    // Message should name the actual length and the limit so the user can act.
    expect(flag?.message).toContain('6');
    expect(flag?.message).toContain('5');
  });

  it('counts Unicode code points, not UTF-16 units (emoji stay one char)', () => {
    // Two emoji = 2 characters to DatoCMS, but 4 UTF-16 code units.
    expect(
      checkFieldLength({ value: '😀😀', validators: lengthMax(2) }),
    ).toBeNull();
  });

  it('treats an `eq` length validator as an upper bound', () => {
    const flag = checkFieldLength({
      value: 'toolong',
      validators: { length: { eq: 3 } } as unknown as FieldValidators,
    });
    expect(flag?.checkId).toBe('length-validator');
  });

  it('does not flag when only a `min` is set (under-length is not this check)', () => {
    expect(
      checkFieldLength({
        value: 'a',
        validators: { length: { min: 10 } } as unknown as FieldValidators,
      }),
    ).toBeNull();
  });

  it('ignores non-string values (e.g. structured/SEO objects)', () => {
    expect(
      checkFieldLength({
        value: { title: 'x' },
        validators: lengthMax(0),
      }),
    ).toBeNull();
  });
});
