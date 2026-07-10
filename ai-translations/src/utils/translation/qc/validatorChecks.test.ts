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

  it('flags an `eq` length validator when the value is longer than eq', () => {
    const flag = checkFieldLength({
      value: 'toolong',
      validators: { length: { eq: 3 } } as unknown as FieldValidators,
    });
    expect(flag?.checkId).toBe('length-validator');
  });

  it('flags an `eq` length validator when the value is shorter than eq', () => {
    // `eq` is an exact constraint: too-short is a 422 just like too-long.
    const flag = checkFieldLength({
      value: 'ab',
      validators: { length: { eq: 3 } } as unknown as FieldValidators,
    });
    expect(flag?.checkId).toBe('length-validator');
  });

  it('returns null when the value is exactly `eq` characters', () => {
    expect(
      checkFieldLength({
        value: 'abc',
        validators: { length: { eq: 3 } } as unknown as FieldValidators,
      }),
    ).toBeNull();
  });

  it('flags a value under the `min` length (DatoCMS will 422 it)', () => {
    // A translation shorter than length.min is rejected on save exactly like an
    // over-max one; the proactive check must name it before the opaque 422.
    const flag = checkFieldLength({
      value: 'a',
      validators: { length: { min: 10 } } as unknown as FieldValidators,
      fieldPath: 'summary',
      locale: 'fr',
    });
    expect(flag).toMatchObject({
      checkId: 'length-validator',
      severity: 'error',
      fieldPath: 'summary',
      locale: 'fr',
    });
    expect(flag?.message).toContain('1');
    expect(flag?.message).toContain('10');
  });

  it('returns null at exactly the `min` length (boundary)', () => {
    expect(
      checkFieldLength({
        value: '1234567890',
        validators: { length: { min: 10 } } as unknown as FieldValidators,
      }),
    ).toBeNull();
  });

  it('flags a blank value against min/eq (DatoCMS 422s it even without `required`)', () => {
    // Empirically verified against the real CMA (forked sandbox): a `length.min`
    // or `length.eq` validator rejects a blank value with VALIDATION_LENGTH, and
    // `length` is enforced INDEPENDENTLY of `required` (a blank value on a
    // required+min field returns BOTH VALIDATION_LENGTH and VALIDATION_REQUIRED).
    // So a blank translation on a min/eq field WILL fail the save — flag it.
    expect(
      checkFieldLength({
        value: '',
        validators: { length: { min: 10 } } as unknown as FieldValidators,
      })?.checkId,
    ).toBe('length-validator');
    expect(
      checkFieldLength({
        value: '',
        validators: { length: { eq: 5 } } as unknown as FieldValidators,
      })?.checkId,
    ).toBe('length-validator');
    // A blank value trivially satisfies a max-only ceiling, so it is NOT flagged.
    expect(
      checkFieldLength({
        value: '',
        validators: { length: { max: 5 } } as unknown as FieldValidators,
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
