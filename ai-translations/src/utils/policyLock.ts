/**
 * Resolves whether a field is LOCKED by the admin translation policy, for the
 * editor-facing surfaces (sidebar per-field menu, run picker). Decisions §1/§2:
 * admin Copy/Skip fates are hard rules editors cannot change per run, and any
 * editor-facing mention of the policy names its owner so they know who to contact.
 */
import { resolveFieldFate, type FieldFate } from '../engine/fieldFate';
import type { FieldValidators } from './translation/SharedFieldUtils';

export interface PolicyLock {
  fate: FieldFate;
  /** True when the admin policy fixes this field (Copy/Skip) — editors can't change it. */
  isLocked: boolean;
  /** Editor-facing explanation (with owner attribution), or null when not locked. */
  reason: string | null;
}

/**
 * Computes the admin-policy lock for a field. Only the admin lists are consulted
 * (no per-run buckets): a `translate` fate is unlocked (an editor may include or
 * omit it per run); `copy`/`exclude` are locked.
 */
export function policyLockForField(args: {
  fieldId: string;
  fieldApiKey: string;
  validators: FieldValidators;
  excludedTokens: string[];
  copyTokens: string[];
}): PolicyLock {
  const fate = resolveFieldFate({
    fieldId: args.fieldId,
    fieldApiKey: args.fieldApiKey,
    validators: args.validators,
    excludedTokens: args.excludedTokens,
    copyTokens: args.copyTokens,
  });
  if (fate === 'translate') return { fate, isLocked: false, reason: null };
  const verb = fate === 'copy' ? 'copied from the source' : 'skipped';
  return {
    fate,
    isLocked: true,
    reason: `This field is ${verb} by the plugin's translation policy set by your admin.`,
  };
}
