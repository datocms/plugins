import type { ConfirmOptions } from 'datocms-plugin-sdk';

export const AUTO_APPROVAL_STORAGE_VERSION = 1 as const;
export const AUTO_APPROVAL_ACKNOWLEDGEMENT_VERSION = 1 as const;

const AUTO_APPROVAL_KEY_PREFIX = 'dato-agent.auto-approval.v1';

export type AutoApprovalScope = {
  pluginId: string;
  siteId: string;
  environment: string;
  currentUserId: string;
};

export type AutoApprovalStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem'
>;

export type AutoApprovalStore = {
  readonly key: string;
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
};

export type AutoApprovalConfirmHost = {
  openConfirm(options: ConfirmOptions): Promise<unknown>;
};

export type AutoApprovalConfirmationContext = {
  siteName: string;
  environment: string;
  isEnvironmentPrimary: boolean;
};

type StoredAutoApproval = {
  version: typeof AUTO_APPROVAL_STORAGE_VERSION;
  acknowledgementVersion: typeof AUTO_APPROVAL_ACKNOWLEDGEMENT_VERSION;
  enabled: true;
};

function normalizeKeyPart(value: string, label: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${label} is required for auto-approval storage.`);
  }

  return encodeURIComponent(normalized);
}

export function autoApprovalStorageKey(scope: AutoApprovalScope): string {
  return [
    AUTO_APPROVAL_KEY_PREFIX,
    normalizeKeyPart(scope.pluginId, 'Plugin ID'),
    normalizeKeyPart(scope.siteId, 'Site ID'),
    normalizeKeyPart(scope.environment, 'Environment ID'),
    normalizeKeyPart(scope.currentUserId, 'Current user ID'),
  ].join(':');
}

function parseStoredAutoApproval(value: string | null): boolean {
  if (!value) {
    return false;
  }

  try {
    const parsed = JSON.parse(value) as Partial<StoredAutoApproval>;
    return (
      parsed.version === AUTO_APPROVAL_STORAGE_VERSION &&
      parsed.acknowledgementVersion === AUTO_APPROVAL_ACKNOWLEDGEMENT_VERSION &&
      parsed.enabled === true
    );
  } catch {
    return false;
  }
}

function browserSessionStorage(): Storage {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    throw new Error('Browser session storage is unavailable.');
  }

  return window.sessionStorage;
}

/**
 * Auto-approval is deliberately session-scoped. It survives iframe remounts and
 * navigation in the current CMS tab, but never silently returns after a browser
 * restart.
 */
export function createAutoApprovalStore(
  scope: AutoApprovalScope,
  storage: AutoApprovalStorage = browserSessionStorage(),
): AutoApprovalStore {
  const key = autoApprovalStorageKey(scope);

  return {
    key,
    isEnabled() {
      const serialized = storage.getItem(key);
      const enabled = parseStoredAutoApproval(serialized);

      if (serialized !== null && !enabled) {
        storage.removeItem(key);
      }

      return enabled;
    },
    setEnabled(enabled) {
      if (!enabled) {
        storage.removeItem(key);
        return;
      }

      const value: StoredAutoApproval = {
        version: AUTO_APPROVAL_STORAGE_VERSION,
        acknowledgementVersion: AUTO_APPROVAL_ACKNOWLEDGEMENT_VERSION,
        enabled: true,
      };
      storage.setItem(key, JSON.stringify(value));
    },
  };
}

/**
 * Uses two CMS-owned confirms so activation looks native and cannot complete
 * through a single accidental click.
 */
export async function confirmEnableAutoApproval(
  host: AutoApprovalConfirmHost,
  context: AutoApprovalConfirmationContext,
): Promise<boolean> {
  const first = await host.openConfirm({
    title: 'Turn on auto-approve?',
    content: 'The agent will run DatoCMS changes without asking first.',
    choices: [
      {
        label: 'Continue',
        value: 'continue',
        intent: 'negative',
      },
    ],
    cancel: { label: 'Cancel', value: 'cancel' },
  });

  if (first !== 'continue') {
    return false;
  }

  const environmentLabel = context.isEnvironmentPrimary
    ? 'Primary'
    : context.environment;
  const second = await host.openConfirm({
    title: 'Allow changes without review?',
    content: `This includes creating, updating, publishing, unpublishing, and deleting content in ${context.siteName} (${environmentLabel}). Save any open record edits first.`,
    choices: [
      {
        label: 'Turn on auto-approve',
        value: 'enable',
        intent: 'negative',
      },
    ],
    cancel: { label: 'Cancel', value: 'cancel' },
  });

  return second === 'enable';
}
