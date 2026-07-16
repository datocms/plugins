/**
 * Invariant: a translated block field must not carry any block id from the
 * SOURCE locale into the target. Translation rebuilds blocks as fresh instances
 * (ids stripped) so the CMA creates new ones; a surviving source id makes the
 * same block instance shared across locales — a corruption prevention
 * (`deepStripBlockIdentifiers`) exists, and this is its verifying backstop
 * (spec §5/§9). A leak blocks the (record,locale).
 */
import type { QcFlag } from '../../../utils/translation/qc/types';

/** Recursively collects every DatoCMS block id ({ type:'item', id }) in a value. */
function collectBlockIds(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectBlockIds(item, into);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  const obj = value as Record<string, unknown>;
  if (obj.type === 'item' && typeof obj.id === 'string') into.add(obj.id);
  for (const nested of Object.values(obj)) collectBlockIds(nested, into);
}

export function checkBlockIdProvenance(args: {
  sourceValue: unknown;
  targetValue: unknown;
  fieldPath?: string;
  locale?: string;
}): QcFlag | null {
  const sourceIds = new Set<string>();
  collectBlockIds(args.sourceValue, sourceIds);
  if (sourceIds.size === 0) return null;

  const targetIds = new Set<string>();
  collectBlockIds(args.targetValue, targetIds);

  const leaked = [...targetIds].filter((id) => sourceIds.has(id));
  if (leaked.length === 0) return null;
  return {
    checkId: 'block-id-provenance',
    severity: 'error',
    fieldPath: args.fieldPath,
    locale: args.locale,
    message: `Source block id(s) leaked into the target locale: ${leaked.join(', ')}; blocks must be rebuilt fresh, not shared across locales.`,
  };
}
