/**
 * Two-list field-fate resolution (spec §4.2).
 *
 * Replaces the single exclude-list check that used to decide, ad hoc, whether
 * a field got translated or skipped. Rev-7 splits admin configuration into
 * two lists — fields to exclude entirely and fields to copy verbatim from
 * the source locale — plus optional per-run buckets that a bulk action can
 * layer on top, but only for fields the admin hasn't already pinned down.
 */

import {
  cannotBeBlank,
  isFieldExcluded,
  type FieldValidators,
} from '../utils/translation/SharedFieldUtils';

export type FieldFate = 'translate' | 'exclude' | 'copy';

/**
 * Rev-7 fate resolution. Legacy configs predate the two-list split, so a
 * legacy "excluded" field that cannot be blank is treated as copy-from-source
 * — which is what v3's locale-sync fallback actually did to it (spec §4.2).
 * Phase 4's migration makes the split persistent; this keeps the engine
 * correct either way.
 *
 * Precedence, highest first:
 * 1. `copyTokens` — admin copy-from-source list. Wins over the exclude list
 *    if a field is somehow on both (defensive; the phase-4 UI forbids it).
 * 2. `excludedTokens` — admin exclude list. A field that `cannotBeBlank`
 *    auto-splits to `copy` instead of `exclude` (legacy behavior); otherwise
 *    it resolves to `exclude`.
 * 3. Run-time buckets (`runSkipIds` / `runCopyIds`) — only consulted for
 *    fields not on either admin list. Per spec §7, admin-listed fields are
 *    locked: a run override never applies to them, so steps 1 and 2 above
 *    always take precedence over a run bucket.
 * 4. Neither list nor bucket — `translate`.
 *
 * @param args.fieldId - The field's DatoCMS ID.
 * @param args.fieldApiKey - The field's API key (fallback match target).
 * @param args.validators - The field's validators, used for the §4.1
 * `cannotBeBlank` auto-split check.
 * @param args.excludedTokens - `pluginParams.apiKeysToBeExcludedFromThisPlugin`.
 * @param args.copyTokens - `pluginParams.fieldsToCopyFromSource ?? []`.
 * @param args.runSkipIds - Phase 5 per-run skip bucket; `undefined` today.
 * @param args.runCopyIds - Phase 5 per-run copy bucket; `undefined` today.
 * @returns The resolved fate for this field.
 */
export const resolveFieldFate = (args: {
  fieldId: string;
  fieldApiKey: string;
  validators: FieldValidators;
  excludedTokens: string[];
  copyTokens: string[];
  runSkipIds?: string[];
  runCopyIds?: string[];
}): FieldFate => {
  const {
    fieldId,
    fieldApiKey,
    validators,
    excludedTokens,
    copyTokens,
    runSkipIds,
    runCopyIds,
  } = args;
  const identifiers = [fieldId, fieldApiKey];

  const isAdminCopy = isFieldExcluded(copyTokens, identifiers);
  const isAdminExcluded = isFieldExcluded(excludedTokens, identifiers);

  if (isAdminCopy) return 'copy';
  if (isAdminExcluded) return cannotBeBlank(validators) ? 'copy' : 'exclude';

  // Admin lists are silent on this field — run-time buckets may apply, but
  // only here: admin-listed fields are locked against run overrides (§7).
  if (isFieldExcluded(runCopyIds ?? [], identifiers)) return 'copy';
  if (isFieldExcluded(runSkipIds ?? [], identifiers)) return 'exclude';

  return 'translate';
};

export { cannotBeBlank };
