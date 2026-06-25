/**
 * Schema-aware QC check: compares a translated value against the DatoCMS field
 * validators that the CMA will enforce on save. Unlike the heuristic checks,
 * this is a hard, deterministic constraint — a value over `length.max` WILL be
 * rejected with a 422 — so it is `error`-tier.
 *
 * Surfacing it as a QC flag (rather than silently truncating, which the card
 * explicitly warns against) lets the user see exactly which field/locale grew
 * too long and fix it, instead of the translation "silently failing and
 * truncating the record".
 */

import type { FieldValidators } from '../SharedFieldUtils';
import type { QcFlag } from './types';

/** Narrowed shape of the string-length validator we care about. */
type LengthValidator = { min?: number; eq?: number; max?: number };

/** Extracts the effective character ceiling (`max`, else `eq`) if any. */
function lengthCeiling(validators: FieldValidators | undefined): number | null {
  if (!validators || typeof validators !== 'object') return null;
  const length = (validators as Record<string, unknown>).length as
    | LengthValidator
    | undefined;
  if (!length || typeof length !== 'object') return null;
  if (typeof length.max === 'number') return length.max;
  if (typeof length.eq === 'number') return length.eq;
  return null;
}

/**
 * Flags when a translated string is longer than the field's `length.max`/`eq`
 * validator allows. DatoCMS counts Unicode characters, so length is measured in
 * code points (`[...str].length`), not UTF-16 units. Non-string values and
 * fields without a length ceiling are ignored.
 */
export function checkFieldLength(args: {
  value: unknown;
  validators: FieldValidators | undefined;
  fieldPath?: string;
  locale?: string;
}): QcFlag | null {
  const { value, validators, fieldPath, locale } = args;
  if (typeof value !== 'string') return null;

  const ceiling = lengthCeiling(validators);
  if (ceiling === null) return null;

  const length = [...value].length;
  if (length <= ceiling) return null;

  return {
    checkId: 'length-validator',
    severity: 'error',
    fieldPath,
    locale,
    message: `Translation is ${length} characters but the field allows at most ${ceiling}; DatoCMS will reject the save until it is shortened.`,
  };
}
