/**
 * localeSelection.ts
 * ------------------
 * Target-locale selection rules shared by the bulk page and the
 * records-action picker modal.
 */
import { ALL_LOCALES_VALUE } from '../../utils/translation/BulkTranslationHelpers';
import type { ChipOption } from './chipOption';

/**
 * The "All other locales" entry that prefixes the target-locale multi-select.
 * It stays a regular option so keyboard navigation and screen-reader behavior
 * match the other locales. No `code`, because "all" has no machine code.
 */
export const ALL_LOCALES_OPTION: ChipOption = {
  label: 'All other locales',
  value: ALL_LOCALES_VALUE,
};

const isAll = (option: ChipOption) => option.value === ALL_LOCALES_VALUE;

/**
 * Soft mutex for the target-locale multi-select: picking "All other locales"
 * clears any specific picks, and picking a specific locale while "All" is
 * selected drops the "All" sentinel. Anything else is taken as is.
 */
export function nextTargetSelection(
  prev: readonly ChipOption[],
  next: readonly ChipOption[],
): ChipOption[] {
  const hadAll = prev.some(isAll);
  const hasAll = next.some(isAll);

  if (!hadAll && hasAll) return [ALL_LOCALES_OPTION];
  if (hadAll && hasAll && next.length > 1) {
    // User added a specific locale while "All" was selected → drop "All".
    return next.filter((option) => !isAll(option));
  }
  return [...next];
}

/**
 * Drops a newly picked source locale from the specific target picks, so it
 * can't linger as a target chip that blocks the run. Falls back to "All
 * other locales" when that empties a non-empty selection.
 */
export function targetsForNewSource(
  prev: ChipOption[],
  sourceValue: string,
): ChipOption[] {
  const next = prev.filter((option) => option.value !== sourceValue);
  if (next.length === prev.length) return prev;
  return next.length === 0 ? [ALL_LOCALES_OPTION] : next;
}
