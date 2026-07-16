/**
 * Invariant: a field whose value cannot be blank (per validators or a
 * model-level `all_locales_required`) must not end up empty. A blank value would
 * 422 on save, so this blocks the (record,locale) pre-send. (spec §5)
 */
import type { QcFlag } from '../../../utils/translation/qc/types';

/** True for null/undefined, whitespace-only strings, empty arrays, empty objects. */
function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  return false;
}

export function checkCannotBeBlank(args: {
  value: unknown;
  cannotBeBlank: boolean;
  fieldPath?: string;
  locale?: string;
}): QcFlag | null {
  if (!args.cannotBeBlank || !isBlank(args.value)) return null;
  return {
    checkId: 'cannot-be-blank',
    severity: 'error',
    fieldPath: args.fieldPath,
    locale: args.locale,
    message: 'Field must not be blank but the translation is empty; DatoCMS will reject the save.',
  };
}
