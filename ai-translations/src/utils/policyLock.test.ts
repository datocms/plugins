import { describe, expect, it } from 'vitest';
import { policyLockForField } from './policyLock';

const args = (over: Partial<Parameters<typeof policyLockForField>[0]> = {}) => ({
  fieldId: 'f1',
  fieldApiKey: 'title',
  validators: {} as never,
  excludedTokens: [] as string[],
  copyTokens: [] as string[],
  ...over,
});

describe('policyLockForField', () => {
  it('leaves a translate-fated field unlocked with no reason', () => {
    const lock = policyLockForField(args());
    expect(lock.fate).toBe('translate');
    expect(lock.isLocked).toBe(false);
    expect(lock.reason).toBeNull();
  });

  it('locks an admin copy-from-source field and attributes the policy to the admin', () => {
    const lock = policyLockForField(args({ copyTokens: ['title'] }));
    expect(lock.fate).toBe('copy');
    expect(lock.isLocked).toBe(true);
    expect(lock.reason).toContain('copied from the source');
    expect(lock.reason).toContain('set by your admin');
  });

  it('locks an admin-excluded optional field as skipped', () => {
    const lock = policyLockForField(args({ excludedTokens: ['title'] }));
    expect(lock.fate).toBe('exclude');
    expect(lock.isLocked).toBe(true);
    expect(lock.reason).toContain('skipped');
    expect(lock.reason).toContain('set by your admin');
  });

  it('reflects the required-exclude auto-split (required excluded field → copy)', () => {
    const lock = policyLockForField(args({ excludedTokens: ['title'], validators: { required: {} } as never }));
    expect(lock.fate).toBe('copy');
    expect(lock.isLocked).toBe(true);
  });
});
