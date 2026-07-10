/**
 * Schema-aware QC check: compares a translated value against the DatoCMS field
 * validators that the CMA will enforce on save. Unlike the heuristic checks,
 * this is a hard, deterministic constraint — a value that violates `length`
 * (over `max`, under `min`, or not exactly `eq`) WILL be rejected with a 422 —
 * so it is `error`-tier.
 *
 * Surfacing it as a QC flag (rather than silently truncating, which the card
 * explicitly warns against) lets the user see exactly which field/locale is out
 * of bounds and fix it, instead of the translation "silently failing and
 * truncating the record".
 */

import type { FieldValidators } from '../SharedFieldUtils';
import type { QcFlag } from './types';

/** Narrowed shape of the string-length validator we care about. */
type LengthValidator = { min?: number; eq?: number; max?: number };

/** Extracts the string-length validator object, if any. */
function lengthValidator(
  validators: FieldValidators | undefined,
): LengthValidator | null {
  if (!validators || typeof validators !== 'object') return null;
  const length = (validators as Record<string, unknown>).length as
    | LengthValidator
    | undefined;
  if (!length || typeof length !== 'object') return null;
  return length;
}

/**
 * Flags when a translated string violates the field's `length` validator in any
 * direction the CMA enforces: over `max`, under `min`, or not exactly `eq`. A
 * `min`-only field whose translation comes back too short 422s on save just as
 * surely as an over-max one, so all three bounds are checked. DatoCMS counts
 * Unicode characters, so length is measured in code points (`[...str].length`),
 * not UTF-16 units. Non-string values and fields without a length validator are
 * ignored.
 */
export function checkFieldLength(args: {
  value: unknown;
  validators: FieldValidators | undefined;
  fieldPath?: string;
  locale?: string;
}): QcFlag | null {
  const { value, validators, fieldPath, locale } = args;
  if (typeof value !== 'string') return null;
  // NB: do NOT exempt a blank value. DatoCMS enforces `length` independently of
  // `required` — a blank value is rejected with VALIDATION_LENGTH by a `min`/`eq`
  // validator (empirically verified against the CMA), so a blank translation on
  // such a field WILL 422 on save and must be flagged. (A `max`-only validator is
  // unaffected: 0 characters trivially satisfies it.)

  const length = lengthValidator(validators);
  if (length === null) return null;

  const count = [...value].length;
  const flag = (message: string): QcFlag => ({
    checkId: 'length-validator',
    severity: 'error',
    fieldPath,
    locale,
    message,
  });

  if (typeof length.eq === 'number' && count !== length.eq) {
    return flag(
      `Translation is ${count} characters but the field requires exactly ${length.eq}; DatoCMS will reject the save until it matches.`,
    );
  }
  if (typeof length.max === 'number' && count > length.max) {
    return flag(
      `Translation is ${count} characters but the field allows at most ${length.max}; DatoCMS will reject the save until it is shortened.`,
    );
  }
  if (typeof length.min === 'number' && count < length.min) {
    return flag(
      `Translation is ${count} characters but the field requires at least ${length.min}; DatoCMS will reject the save until it is lengthened.`,
    );
  }
  return null;
}
