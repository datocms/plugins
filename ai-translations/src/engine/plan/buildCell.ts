/**
 * Builds one {@link CellPlan} — a single field translated into a single target
 * locale — from source content, schema, and the locked policy (spec §5).
 * Pre-flight only: placeholder/segment expectations are populated later, at
 * reconstruct time.
 */
import { cannotBeBlank, resolveFieldFate } from '../fieldFate';
import { getExactSourceValue } from '../../utils/translation/SharedFieldUtils';
import { blockSignatureOf } from './checks/blockStructure';
import { lengthBoundsOf } from './lengthBounds';
import type { PlanField, PlanPolicy, PlanRecord } from './buildPlanTypes';
import type { CellExpectation, CellPlan } from './types';

/** A block-bearing value: an array of blocks or a single `{ type: 'item' }` block. */
function isBlockBearing(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(isBlockBearing);
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).type === 'item'
  );
}

export function buildCell(args: {
  field: PlanField;
  record: PlanRecord;
  toLocale: string;
  fromLocale: string;
  policy: PlanPolicy;
  allLocalesRequired: boolean;
}): CellPlan {
  const { field, record, toLocale, fromLocale, policy, allLocalesRequired } = args;

  let fate = resolveFieldFate({
    fieldId: field.id,
    fieldApiKey: field.apiKey,
    validators: field.validators,
    excludedTokens: policy.excludedTokens,
    copyTokens: policy.copyTokens,
  });
  // Under all_locales_required, a would-be excluded field must still carry a
  // value in every locale — copy from source rather than leave it null (spec §5).
  if (allLocalesRequired && fate === 'exclude') fate = 'copy';

  const mustNotBlank = cannotBeBlank(field.validators) || allLocalesRequired;

  const fieldData = record[field.apiKey];
  const isLocaleObject =
    fieldData !== null &&
    typeof fieldData === 'object' &&
    !Array.isArray(fieldData);
  const preservedLocales = isLocaleObject
    ? Object.keys(fieldData as Record<string, unknown>)
    : [];

  const expected: CellExpectation = { preservedLocales };
  const bounds = lengthBoundsOf(field.validators);
  if (bounds) expected.lengthBounds = bounds;

  const sourceValue = getExactSourceValue(
    fieldData as Record<string, unknown> | undefined,
    fromLocale,
  );
  if (isBlockBearing(sourceValue)) {
    expected.blockSignature = blockSignatureOf(sourceValue);
  }

  return {
    fieldPath: field.apiKey,
    fieldType: field.fieldType,
    toLocale,
    fate,
    cannotBeBlank: mustNotBlank,
    expected,
  };
}
