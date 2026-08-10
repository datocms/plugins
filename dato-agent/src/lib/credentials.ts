export const OAUTH_CREDENTIALS_VERSION = 1 as const;
export const OAUTH_CLIENT_REGISTRATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const OAUTH_CLIENT_REGISTRATION_SAFETY_MARGIN_MS = 60 * 60 * 1000;

const CREDENTIALS_KEY_PREFIX = 'dato-agent.oauth.credentials.v1';

export type CredentialScope = {
  siteId: string;
  currentUserId: string;
};

export type OAuthClientCredentials = {
  clientId: string;
  clientIdIssuedAt: number;
  redirectUri: string;
};

export type OAuthAccessToken = {
  accessToken: string;
  tokenType: 'Bearer';
  obtainedAt: number;
};

export type OAuthCredentials = {
  version: typeof OAUTH_CREDENTIALS_VERSION;
  client: OAuthClientCredentials;
  token?: OAuthAccessToken;
};

export type CredentialPersistence = 'session' | 'local';

export type LoadedOAuthCredentials = {
  credentials: OAuthCredentials;
  persistence: CredentialPersistence;
};

export type CredentialStoreOptions = {
  sessionStorage?: Storage;
  localStorage?: Storage;
};

export type SaveCredentialOptions = {
  remember?: boolean;
};

export type OAuthCredentialStore = {
  readonly key: string;
  load(): LoadedOAuthCredentials | null;
  save(
    credentials: OAuthCredentials,
    options?: SaveCredentialOptions,
  ): LoadedOAuthCredentials;
  setRemembered(remember: boolean): LoadedOAuthCredentials | null;
  isRemembered(): boolean;
  clear(): void;
};

export class CredentialStorageError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'CredentialStorageError';
    this.cause = cause;
  }
}

/**
 * Builds a storage key scoped to one DatoCMS project and one user. OAuth
 * credentials must never be shared between accounts using the same browser.
 */
export function buildCredentialStorageKey(scope: CredentialScope): string {
  const siteId = normalizeScopePart(scope.siteId, 'siteId');
  const currentUserId = normalizeScopePart(
    scope.currentUserId,
    'currentUserId',
  );

  return `${CREDENTIALS_KEY_PREFIX}:${encodeURIComponent(siteId)}:${encodeURIComponent(currentUserId)}`;
}

/**
 * Creates a browser credential store. Credentials are remembered on the
 * current device unless a caller explicitly requests session-only persistence.
 */
export function createCredentialStore(
  scope: CredentialScope,
  options: CredentialStoreOptions = {},
): OAuthCredentialStore {
  const key = buildCredentialStorageKey(scope);
  const session = options.sessionStorage ?? getBrowserStorage('sessionStorage');
  const local = options.localStorage ?? getBrowserStorage('localStorage');

  const loadFrom = (
    storage: Storage,
    persistence: CredentialPersistence,
  ): LoadedOAuthCredentials | null => {
    const serialized = readStorage(storage, key);
    if (serialized === null) {
      return null;
    }

    const credentials = parseOAuthCredentials(serialized);
    if (!credentials) {
      removeStorage(storage, key);
      return null;
    }

    return { credentials, persistence };
  };

  const load = (): LoadedOAuthCredentials | null =>
    loadFrom(session, 'session') ?? loadFrom(local, 'local');

  const save = (
    credentials: OAuthCredentials,
    saveOptions: SaveCredentialOptions = {},
  ): LoadedOAuthCredentials => {
    const normalized = normalizeOAuthCredentials(credentials);
    const remember = saveOptions.remember !== false;
    const target = remember ? local : session;
    const other = remember ? session : local;

    // Write first so a storage failure does not destroy a previously working
    // credential record in the other persistence tier.
    writeStorage(target, key, JSON.stringify(normalized));
    removeStorage(other, key);

    return {
      credentials: normalized,
      persistence: remember ? 'local' : 'session',
    };
  };

  const setRemembered = (remember: boolean): LoadedOAuthCredentials | null => {
    const loaded = load();
    if (!loaded) {
      return null;
    }
    if (
      (remember && loaded.persistence === 'local') ||
      (!remember && loaded.persistence === 'session')
    ) {
      return loaded;
    }
    return save(loaded.credentials, { remember });
  };

  return {
    key,
    load,
    save,
    setRemembered,
    isRemembered: () => load()?.persistence === 'local',
    clear: () => {
      removeStorage(session, key);
      removeStorage(local, key);
    },
  };
}

export function createOAuthCredentials(
  client: OAuthClientCredentials,
  token?: OAuthAccessToken,
): OAuthCredentials {
  return normalizeOAuthCredentials({
    version: OAUTH_CREDENTIALS_VERSION,
    client,
    token,
  });
}

/**
 * DCR registrations live for 30 days server-side. Treat them as stale one
 * hour early so a connection does not expire during an authorization flow.
 */
export function isOAuthClientRegistrationFresh(
  client: OAuthClientCredentials,
  now = Date.now(),
): boolean {
  if (!isFiniteNonNegativeNumber(client.clientIdIssuedAt)) {
    return false;
  }

  const issuedAt = client.clientIdIssuedAt * 1000;
  if (issuedAt > now + OAUTH_CLIENT_REGISTRATION_SAFETY_MARGIN_MS) {
    return false;
  }

  return (
    now <
    issuedAt +
      OAUTH_CLIENT_REGISTRATION_TTL_MS -
      OAUTH_CLIENT_REGISTRATION_SAFETY_MARGIN_MS
  );
}

function normalizeScopePart(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new CredentialStorageError(`${name} must not be empty`);
  }
  return normalized;
}

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

const memorySessionStorage = createMemoryStorage();
const memoryLocalStorage = createMemoryStorage();

function getBrowserStorage(name: 'sessionStorage' | 'localStorage'): Storage {
  try {
    const storage = globalThis[name];
    if (!storage) {
      throw new Error(`${name} is unavailable`);
    }
    return storage;
  } catch {
    return name === 'sessionStorage'
      ? memorySessionStorage
      : memoryLocalStorage;
  }
}

function readStorage(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch (error) {
    throw new CredentialStorageError('Could not read OAuth credentials', error);
  }
}

function writeStorage(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch (error) {
    throw new CredentialStorageError(
      'Could not store OAuth credentials in this browser',
      error,
    );
  }
}

function removeStorage(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch (error) {
    throw new CredentialStorageError(
      'Could not clear OAuth credentials from this browser',
      error,
    );
  }
}

function parseOAuthCredentials(serialized: string): OAuthCredentials | null {
  try {
    return normalizeOAuthCredentials(JSON.parse(serialized));
  } catch {
    return null;
  }
}

function normalizeOAuthCredentials(value: unknown): OAuthCredentials {
  if (!isRecord(value) || value.version !== OAUTH_CREDENTIALS_VERSION) {
    throw new CredentialStorageError(
      'Stored OAuth credentials have an unsupported format',
    );
  }

  const client = normalizeClientCredentials(value.client);
  const token =
    value.token === undefined ? undefined : normalizeAccessToken(value.token);

  return {
    version: OAUTH_CREDENTIALS_VERSION,
    client,
    ...(token ? { token } : {}),
  };
}

function normalizeClientCredentials(value: unknown): OAuthClientCredentials {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.clientId) ||
    !isFiniteNonNegativeNumber(value.clientIdIssuedAt) ||
    !isCleanAbsoluteUrl(value.redirectUri)
  ) {
    throw new CredentialStorageError('Invalid OAuth client credentials');
  }

  return {
    clientId: value.clientId,
    clientIdIssuedAt: value.clientIdIssuedAt,
    redirectUri: value.redirectUri,
  };
}

function normalizeAccessToken(value: unknown): OAuthAccessToken {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.accessToken) ||
    value.tokenType !== 'Bearer' ||
    !isFiniteNonNegativeNumber(value.obtainedAt)
  ) {
    throw new CredentialStorageError('Invalid OAuth access token');
  }

  return {
    accessToken: value.accessToken,
    tokenType: 'Bearer',
    obtainedAt: value.obtainedAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isCleanAbsoluteUrl(value: unknown): value is string {
  if (!isNonEmptyString(value)) {
    return false;
  }

  try {
    const url = new URL(value);
    return !url.search && !url.hash;
  } catch {
    return false;
  }
}
