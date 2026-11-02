import { describe, expect, it, vi } from 'vitest';
import {
  AUTO_APPROVAL_ACKNOWLEDGEMENT_VERSION,
  AUTO_APPROVAL_STORAGE_VERSION,
  type AutoApprovalStorage,
  autoApprovalStorageKey,
  confirmEnableAutoApproval,
  createAutoApprovalStore,
} from './autoApproval';

class MemoryStorage implements AutoApprovalStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const scope = {
  pluginId: 'plugin',
  siteId: 'site',
  environment: 'primary',
  currentUserId: 'user',
};

describe('auto-approval persistence', () => {
  it('defaults off and round-trips only a current acknowledgement', () => {
    const storage = new MemoryStorage();
    const store = createAutoApprovalStore(scope, storage);

    expect(store.isEnabled()).toBe(false);

    store.setEnabled(true);
    expect(store.isEnabled()).toBe(true);
    expect(JSON.parse(storage.getItem(store.key) ?? '{}')).toEqual({
      version: AUTO_APPROVAL_STORAGE_VERSION,
      acknowledgementVersion: AUTO_APPROVAL_ACKNOWLEDGEMENT_VERSION,
      enabled: true,
    });

    store.setEnabled(false);
    expect(store.isEnabled()).toBe(false);
    expect(storage.getItem(store.key)).toBeNull();
  });

  it('isolates the mode by plugin, project, environment, and user', () => {
    const base = autoApprovalStorageKey(scope);
    const variants = [
      autoApprovalStorageKey({ ...scope, pluginId: 'other-plugin' }),
      autoApprovalStorageKey({ ...scope, siteId: 'other-site' }),
      autoApprovalStorageKey({ ...scope, environment: 'staging' }),
      autoApprovalStorageKey({ ...scope, currentUserId: 'other-user' }),
    ];

    expect(new Set([base, ...variants])).toHaveLength(5);
  });

  it('fails closed and removes malformed or stale values', () => {
    const storage = new MemoryStorage();
    const store = createAutoApprovalStore(scope, storage);

    for (const value of [
      'not-json',
      JSON.stringify({ version: 0, acknowledgementVersion: 1, enabled: true }),
      JSON.stringify({ version: 1, acknowledgementVersion: 0, enabled: true }),
      JSON.stringify({ version: 1, acknowledgementVersion: 1, enabled: true }),
      JSON.stringify({
        version: 1,
        acknowledgementVersion: AUTO_APPROVAL_ACKNOWLEDGEMENT_VERSION,
        enabled: false,
      }),
    ]) {
      storage.setItem(store.key, value);
      expect(store.isEnabled()).toBe(false);
      expect(storage.getItem(store.key)).toBeNull();
    }
  });

  it('does not report enabled when browser storage rejects the write', () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {
      throw new Error('Storage blocked');
    };
    const store = createAutoApprovalStore(scope, storage);

    expect(() => store.setEnabled(true)).toThrow('Storage blocked');
    expect(store.isEnabled()).toBe(false);
  });
});

describe('auto-approval confirmation', () => {
  const context = {
    siteName: 'Marketing Website',
  };

  it('stays off when the confirmation is cancelled', async () => {
    const openConfirm = vi.fn().mockResolvedValue('cancel');

    await expect(
      confirmEnableAutoApproval({ openConfirm }, context),
    ).resolves.toBe(false);
    expect(openConfirm).toHaveBeenCalledOnce();
  });

  it('requires the exact sentinel of one danger confirmation', async () => {
    const openConfirm = vi.fn().mockResolvedValue('enable');

    await expect(
      confirmEnableAutoApproval({ openConfirm }, context),
    ).resolves.toBe(true);

    expect(openConfirm).toHaveBeenCalledOnce();
    expect(openConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Turn on auto-approve?',
        content: expect.stringMatching(
          /change, publish or delete anything your role allows in Marketing Website, in every environment, without asking you.*can’t be undone/i,
        ),
        choices: [
          expect.objectContaining({ value: 'enable', intent: 'negative' }),
        ],
        cancel: expect.objectContaining({ value: 'cancel' }),
      }),
    );
  });
});
