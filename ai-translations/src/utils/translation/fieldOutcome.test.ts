import { describe, expect, it } from 'vitest';
import { shouldApplyLocaleSyncFallback } from './ItemsDropdownUtils';
import type { FieldOutcome } from './types';

const failed: FieldOutcome = {
  status: 'failed',
  error: { code: 'rate_limit', source: 'provider', message: 'Rate limit reached.' },
};

describe('shouldApplyLocaleSyncFallback', () => {
  it('never fills a field whose provider call failed', () =>
    expect(shouldApplyLocaleSyncFallback(failed)).toBe(false));

  it('fills an untranslatable field', () =>
    expect(shouldApplyLocaleSyncFallback({ status: 'untranslatable' })).toBe(true));

  it('fills a field with no outcome at all (not in the translatable set)', () =>
    expect(shouldApplyLocaleSyncFallback(undefined)).toBe(true));

  it('does not re-fill an already-translated field', () =>
    expect(shouldApplyLocaleSyncFallback({ status: 'translated', value: 'Bonjour' })).toBe(false));
});
