/**
 * fate.ts
 * -------
 * Pure fate derivation and mutation over the two sparse token lists
 * (spec §1). The engine's `resolveFieldFate` reads the same lists at runtime;
 * this module is the config UI's read/write mirror of that logic.
 */

import { isFieldExcluded } from '../../../utils/translation/SharedFieldUtils';
import type { FateLists, FateSummary, FieldFate } from './types';

/** Minimal identity a fate decision needs. */
export interface FateNodeRef {
  id: string;
  apiKey: string;
  required: boolean;
}

/**
 * Derives a field's fate from the two sparse token lists.
 *
 * Copy wins over exclude (matches the engine's precedence). A required field
 * can never resolve to `skip` — the engine auto-splits an excluded required
 * field to copy-from-source, so a stored exclude token on a required field is
 * shown as `translate` unless the field is also copy-listed.
 *
 * @param node - The field's id, api_key, and required flag.
 * @param lists - The current exclude/copy token arrays.
 * @returns The resolved fate.
 */
export const fateOf = (node: FateNodeRef, lists: FateLists): FieldFate => {
  const ids = [node.id, node.apiKey];
  if (isFieldExcluded(lists.copyTokens, ids)) return 'copy';
  if (isFieldExcluded(lists.excludedTokens, ids)) {
    return node.required ? 'translate' : 'skip';
  }
  return 'translate';
};

const without = (tokens: string[], id: string, apiKey: string): string[] =>
  tokens.filter((token) => token !== id && token !== apiKey);

/**
 * Returns new token lists with this field set to `fate`. Removes the field (by
 * id AND api_key) from both lists first, so a field is never in both;
 * `translate` leaves it in neither. Immutable — inputs are untouched.
 *
 * @param id - Field id (the token written for copy/skip).
 * @param apiKey - Field api_key (removed as a legacy-token fallback).
 * @param fate - The fate to store.
 * @param lists - The current token arrays.
 * @returns New token arrays.
 */
export const setFate = (
  id: string,
  apiKey: string,
  fate: FieldFate,
  lists: FateLists,
): FateLists => {
  const excludedTokens = without(lists.excludedTokens, id, apiKey);
  const copyTokens = without(lists.copyTokens, id, apiKey);
  if (fate === 'skip') excludedTokens.push(id);
  if (fate === 'copy') copyTokens.push(id);
  return { excludedTokens, copyTokens };
};

/**
 * Tallies a list of resolved fates. The result always sums to the input length
 * — there is no "unassigned" bucket.
 */
export const summarize = (fates: FieldFate[]): FateSummary =>
  fates.reduce<FateSummary>((acc, fate) => ({ ...acc, [fate]: acc[fate] + 1 }), {
    translate: 0,
    copy: 0,
    skip: 0,
  });
