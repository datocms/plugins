/**
 * Extracts a field's string-length bounds from its validators, for the
 * `length-validator` invariant's expectation (spec §5). A value that violates
 * these bounds would 422 on save, so the plan carries them so `conform` can
 * block pre-send.
 */
import type { FieldValidators } from '../../utils/translation/SharedFieldUtils';

/** The field's length bounds ({min,eq,max}) when it has a length validator, else undefined. */
export function lengthBoundsOf(
  validators: FieldValidators,
): { min?: number; eq?: number; max?: number } | undefined {
  if (!validators || typeof validators !== 'object') return undefined;
  const length = (validators as Record<string, unknown>).length as
    | { min?: number; eq?: number; max?: number }
    | undefined;
  if (!length || typeof length !== 'object') return undefined;
  const bounds: { min?: number; eq?: number; max?: number } = {};
  if (typeof length.min === 'number') bounds.min = length.min;
  if (typeof length.eq === 'number') bounds.eq = length.eq;
  if (typeof length.max === 'number') bounds.max = length.max;
  return Object.keys(bounds).length > 0 ? bounds : undefined;
}
