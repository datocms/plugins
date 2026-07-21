import { describe, expect, it } from 'vitest';
import { DEVICE_ID_STORAGE_KEY, getStableDeviceId } from './deviceId';

/** A minimal in-memory Storage shim for deterministic tests. */
const makeStorage = (initial: Record<string, string> = {}) => {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string): string | null => map.get(k) ?? null,
    setItem: (k: string, v: string): void => {
      map.set(k, v);
    },
  };
};

describe('getStableDeviceId', () => {
  it('returns the persisted id when one already exists', () => {
    const storage = makeStorage({ [DEVICE_ID_STORAGE_KEY]: 'existing-id' });
    expect(getStableDeviceId(storage)).toBe('existing-id');
  });

  it('generates and persists a new id when none exists', () => {
    const storage = makeStorage();
    const id = getStableDeviceId(storage);
    expect(id).toBeTruthy();
    expect(storage.getItem(DEVICE_ID_STORAGE_KEY)).toBe(id);
  });

  it('is stable across calls against the same storage', () => {
    const storage = makeStorage();
    expect(getStableDeviceId(storage)).toBe(getStableDeviceId(storage));
  });

  it('falls back to an ephemeral id when storage is unavailable', () => {
    expect(getStableDeviceId(null)).toBeTruthy();
  });

  it('does not throw when storage access fails, returning an ephemeral id', () => {
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(getStableDeviceId(throwing)).toBeTruthy();
  });
});
