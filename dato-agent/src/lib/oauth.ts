import type {
  CredentialScope,
  OAuthAccessToken,
  OAuthClientCredentials,
} from './credentials';

export const MCP_BASE_URL = 'https://mcp.datocms.com';
export const OAUTH_SCOPES = 'read_account read_sites read_organizations';
export const OAUTH_POPUP_MESSAGE_TYPE = 'dato-agent.oauth.callback.v1';
export const PENDING_AUTHORIZATION_TTL_MS = 5 * 60 * 1000;

const PENDING_AUTHORIZATION_KEY_PREFIX = 'dato-agent.oauth.pending.v1';
const DEFAULT_POPUP_FEATURES =
  'width=520,height=720,menubar=no,toolbar=no,location=no,status=no';

export type FetchFunction = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type OAuthCrypto = Pick<Crypto, 'getRandomValues' | 'subtle'>;

export type OAuthRequestOptions = {
  fetch?: FetchFunction;
  now?: () => number;
};

export type PendingAuthorizationOptions = {
  sessionStorage?: Storage;
  crypto?: OAuthCrypto;
  now?: () => number;
};

export type PendingAuthorization = {
  version: 1;
  state: string;
  codeVerifier: string;
  clientId: string;
  redirectUri: string;
  createdAt: number;
  expiresAt: number;
};

export type AuthorizationRequest = {
  authorizationUrl: string;
  state: string;
  expiresAt: number;
};

export type OAuthCallback =
  | {
      ok: true;
      code: string;
      state: string;
    }
  | {
      ok: false;
      error: string;
      errorDescription?: string;
      state: string | null;
    };

export type OAuthPopupMessage = {
  type: typeof OAUTH_POPUP_MESSAGE_TYPE;
  callback: OAuthCallback;
};

export type OAuthPopupOptions = {
  hostWindow?: Pick<Window, 'open'>;
  name?: string;
  features?: string;
};

export type WaitForOAuthCallbackOptions = {
  hostWindow?: Pick<
    Window,
    | 'addEventListener'
    | 'removeEventListener'
    | 'setInterval'
    | 'clearInterval'
    | 'setTimeout'
    | 'clearTimeout'
  >;
  callbackOrigin?: string;
  timeoutMs?: number;
};

export type PostOAuthCallbackOptions = {
  url?: string | URL;
  opener?: Pick<Window, 'postMessage'> | null;
  close?: () => void;
  schedule?: (callback: () => void, delay: number) => unknown;
};

export class RemoteMcpOAuthError extends Error {
  readonly status?: number;

  constructor(message: string, options: { status?: number } = {}) {
    super(message);
    this.name = 'RemoteMcpOAuthError';
    this.status = options.status;
  }
}

/**
 * Returns the current plugin document URL without query parameters or a
 * fragment. The remote MCP appends `?code=...` directly to this URL.
 */
export function computeRedirectUri(
  location: Pick<Location, 'origin' | 'pathname'> = window.location,
): string {
  return validateRedirectUri(`${location.origin}${location.pathname}`);
}

/**
 * Validates the exact redirect URI used for DCR and authorization.
 */
export function validateRedirectUri(redirectUri: string): string {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    throw new RemoteMcpOAuthError(
      'The OAuth callback URL must be an absolute URL',
    );
  }

  if (url.search || url.hash) {
    throw new RemoteMcpOAuthError(
      'The OAuth callback URL must not contain a query string or fragment',
    );
  }

  const isLoopback =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    throw new RemoteMcpOAuthError(
      'The OAuth callback URL must use HTTPS outside local development',
    );
  }

  return url.href;
}

/**
 * Registers a public OAuth client. The returned client ID is not a secret and
 * can be stored with the user's browser credentials.
 */
export async function registerClient(
  redirectUri: string,
  options: OAuthRequestOptions = {},
): Promise<OAuthClientCredentials> {
  const cleanRedirectUri = validateRedirectUri(redirectUri);
  const fetchFunction = options.fetch ?? getBrowserFetch();
  const response = await fetchFunction(`${MCP_BASE_URL}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'DatoCMS Agent Plugin',
      redirect_uris: [cleanRedirectUri],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: OAUTH_SCOPES,
    }),
  });

  if (!response.ok) {
    throw httpError('Dynamic client registration', response);
  }

  const data = await readJsonObject(response, 'client registration');
  if (!isNonEmptyString(data.client_id)) {
    throw new RemoteMcpOAuthError(
      'Dynamic client registration returned no client ID',
    );
  }

  return {
    clientId: data.client_id,
    clientIdIssuedAt: isFiniteNonNegativeNumber(data.client_id_issued_at)
      ? data.client_id_issued_at
      : Math.floor((options.now ?? Date.now)() / 1000),
    redirectUri: cleanRedirectUri,
  };
}

/**
 * Generates PKCE S256 and cryptographic state, saves the pending session for
 * five minutes in sessionStorage, and returns the URL for the OAuth popup.
 */
export async function createAuthorizationRequest(
  args: {
    scope: CredentialScope;
    clientId: string;
    redirectUri: string;
  },
  options: PendingAuthorizationOptions = {},
): Promise<AuthorizationRequest> {
  if (!isNonEmptyString(args.clientId)) {
    throw new RemoteMcpOAuthError('OAuth client ID must not be empty');
  }

  const redirectUri = validateRedirectUri(args.redirectUri);
  const cryptoSource = options.crypto ?? getBrowserCrypto();
  const now = (options.now ?? Date.now)();
  const codeVerifier = base64UrlEncode(randomBytes(32, cryptoSource));
  const state = base64UrlEncode(randomBytes(32, cryptoSource));
  const codeChallenge = await sha256Base64Url(codeVerifier, cryptoSource);
  const pending: PendingAuthorization = {
    version: 1,
    state,
    codeVerifier,
    clientId: args.clientId,
    redirectUri,
    createdAt: now,
    expiresAt: now + PENDING_AUTHORIZATION_TTL_MS,
  };

  writePendingAuthorization(
    args.scope,
    pending,
    options.sessionStorage ?? getBrowserSessionStorage(),
  );

  const params = new URLSearchParams({
    client_id: args.clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    scope: OAUTH_SCOPES,
  });

  return {
    authorizationUrl: `${MCP_BASE_URL}/authorize?${params.toString()}`,
    state,
    expiresAt: pending.expiresAt,
  };
}

/**
 * Opens a blank popup synchronously. Call this directly from the user's click
 * handler, before awaiting DCR or PKCE work, to avoid popup blocking.
 */
export function openOAuthPopup(options: OAuthPopupOptions = {}): Window {
  const hostWindow = options.hostWindow ?? window;
  const popup = hostWindow.open(
    'about:blank',
    options.name ?? 'dato-agent-oauth',
    options.features ?? DEFAULT_POPUP_FEATURES,
  );

  if (!popup) {
    throw new RemoteMcpOAuthError(
      'The sign-in popup was blocked. Allow popups and try again.',
    );
  }

  return popup;
}

export function navigateOAuthPopup(
  popup: Window,
  authorizationUrl: string,
): void {
  const url = new URL(authorizationUrl);
  if (url.origin !== MCP_BASE_URL || url.pathname !== '/authorize') {
    throw new RemoteMcpOAuthError('Invalid OAuth authorization URL');
  }
  popup.location.assign(url.href);
}

/**
 * Waits for the same-origin callback page to post its parsed result.
 */
export function waitForOAuthCallback(
  popup: Window,
  expectedState: string,
  options: WaitForOAuthCallbackOptions = {},
): Promise<{ code: string; state: string }> {
  if (!isNonEmptyString(expectedState)) {
    return Promise.reject(
      new RemoteMcpOAuthError('Expected OAuth state must not be empty'),
    );
  }

  const hostWindow = options.hostWindow ?? window;
  const callbackOrigin = options.callbackOrigin ?? window.location.origin;
  const timeoutMs = Math.min(
    options.timeoutMs ?? PENDING_AUTHORIZATION_TTL_MS,
    PENDING_AUTHORIZATION_TTL_MS,
  );

  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      hostWindow.removeEventListener('message', onMessage);
      hostWindow.clearInterval(closedPoller);
      hostWindow.clearTimeout(timeout);
    };

    const settle = (action: () => void, closePopup = true) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (closePopup && !popup.closed) {
        popup.close();
      }
      action();
    };

    const onMessage = (event: Event) => {
      const messageEvent = event as MessageEvent<unknown>;
      if (
        messageEvent.origin !== callbackOrigin ||
        messageEvent.source !== popup ||
        !isOAuthPopupMessage(messageEvent.data)
      ) {
        return;
      }

      const { callback } = messageEvent.data;
      if (callback.state !== expectedState) {
        settle(() => reject(new RemoteMcpOAuthError('OAuth state mismatch')));
        return;
      }

      if (!callback.ok) {
        const description = callback.errorDescription
          ? `: ${callback.errorDescription}`
          : '';
        settle(
          () =>
            reject(
              new RemoteMcpOAuthError(
                `OAuth authorization failed (${callback.error})${description}`,
              ),
            ),
          false,
        );
        return;
      }

      settle(() => resolve({ code: callback.code, state: callback.state }));
    };

    hostWindow.addEventListener('message', onMessage);

    const closedPoller = hostWindow.setInterval(() => {
      if (popup.closed) {
        settle(
          () =>
            reject(
              new RemoteMcpOAuthError(
                'The sign-in popup was closed before authorization completed',
              ),
            ),
          false,
        );
      }
    }, 300);

    const timeout = hostWindow.setTimeout(
      () => {
        settle(() =>
          reject(new RemoteMcpOAuthError('OAuth authorization timed out')),
        );
      },
      Math.max(1, timeoutMs),
    );
  });
}

/**
 * Parses a callback URL without mutating browser state.
 */
export function parseOAuthCallback(input: string | URL): OAuthCallback | null {
  const url = input instanceof URL ? input : new URL(input);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  if (!code && !error) {
    return null;
  }

  if (error) {
    return {
      ok: false,
      error,
      ...(errorDescription ? { errorDescription } : {}),
      state,
    };
  }

  if (!code || !state) {
    throw new RemoteMcpOAuthError(
      'OAuth callback is missing its code or state',
    );
  }

  return { ok: true, code, state };
}

/**
 * Runs on the standalone callback page before booting the DatoCMS plugin SDK.
 * It posts the callback only to the same-origin opener.
 */
export function postOAuthCallbackToOpener(
  options: PostOAuthCallbackOptions = {},
): boolean {
  const url =
    options.url instanceof URL
      ? options.url
      : new URL(options.url ?? window.location.href);
  const callback = parseOAuthCallback(url);
  if (!callback) {
    return false;
  }

  const opener = options.opener === undefined ? window.opener : options.opener;
  if (!opener) {
    return false;
  }

  const message: OAuthPopupMessage = {
    type: OAUTH_POPUP_MESSAGE_TYPE,
    callback,
  };
  opener.postMessage(message, url.origin);

  const close = options.close ?? (() => window.close());
  const schedule =
    options.schedule ??
    ((callback, delay) => window.setTimeout(callback, delay));
  schedule(close, 50);
  return true;
}

export function handleOAuthCallbackIfPresent(): boolean {
  return postOAuthCallbackToOpener();
}

/**
 * Consumes the pending state and exchanges its one-time code for a DatoCMS
 * access token.
 */
export async function exchangeAuthorizationCode(
  args: {
    scope: CredentialScope;
    code: string;
    state: string;
  },
  options: {
    sessionStorage?: Storage;
    fetch?: FetchFunction;
    now?: () => number;
  } = {},
): Promise<OAuthAccessToken> {
  if (!isNonEmptyString(args.code)) {
    throw new RemoteMcpOAuthError('OAuth authorization code must not be empty');
  }

  const now = (options.now ?? Date.now)();
  const pending = consumePendingAuthorization(args.scope, args.state, {
    sessionStorage: options.sessionStorage,
    now: () => now,
  });
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: args.code,
    client_id: pending.clientId,
    code_verifier: pending.codeVerifier,
    redirect_uri: pending.redirectUri,
  });
  const response = await (options.fetch ?? getBrowserFetch())(
    `${MCP_BASE_URL}/token`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    },
  );

  if (!response.ok) {
    throw httpError('OAuth token exchange', response);
  }

  const data = await readJsonObject(response, 'token exchange');
  if (!isNonEmptyString(data.access_token)) {
    throw new RemoteMcpOAuthError(
      'OAuth token exchange returned no access token',
    );
  }
  if (
    data.token_type !== undefined &&
    (!isNonEmptyString(data.token_type) ||
      data.token_type.toLowerCase() !== 'bearer')
  ) {
    throw new RemoteMcpOAuthError(
      'OAuth token exchange returned an unsupported token type',
    );
  }

  return {
    accessToken: data.access_token,
    tokenType: 'Bearer',
    obtainedAt: now,
  };
}

export async function revokeToken(
  args: {
    accessToken: string;
    clientId: string;
  },
  options: Pick<OAuthRequestOptions, 'fetch'> = {},
): Promise<void> {
  if (!isNonEmptyString(args.accessToken) || !isNonEmptyString(args.clientId)) {
    throw new RemoteMcpOAuthError(
      'An access token and client ID are required to disconnect',
    );
  }

  const response = await (options.fetch ?? getBrowserFetch())(
    `${MCP_BASE_URL}/revoke`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        token: args.accessToken,
        client_id: args.clientId,
      }).toString(),
    },
  );

  if (!response.ok) {
    throw httpError('OAuth token revocation', response);
  }
}

export function consumePendingAuthorization(
  scope: CredentialScope,
  state: string,
  options: {
    sessionStorage?: Storage;
    now?: () => number;
  } = {},
): PendingAuthorization {
  if (!isNonEmptyString(state)) {
    throw new RemoteMcpOAuthError('OAuth state must not be empty');
  }

  const storage = options.sessionStorage ?? getBrowserSessionStorage();
  const key = buildPendingAuthorizationKey(scope, state);
  let serialized: string | null;
  try {
    serialized = storage.getItem(key);
    storage.removeItem(key);
  } catch {
    throw new RemoteMcpOAuthError('Could not read the pending OAuth session');
  }

  if (!serialized) {
    throw new RemoteMcpOAuthError(
      'The OAuth session is missing or has already been used',
    );
  }

  const pending = parsePendingAuthorization(serialized);
  if (!pending || pending.state !== state) {
    throw new RemoteMcpOAuthError('The pending OAuth session is invalid');
  }

  const now = (options.now ?? Date.now)();
  if (
    pending.expiresAt <= now ||
    pending.expiresAt - pending.createdAt !== PENDING_AUTHORIZATION_TTL_MS
  ) {
    throw new RemoteMcpOAuthError(
      'The OAuth session expired. Start the connection again.',
    );
  }

  return pending;
}

export function discardPendingAuthorization(
  scope: CredentialScope,
  state: string,
  sessionStorage: Storage = getBrowserSessionStorage(),
): void {
  try {
    sessionStorage.removeItem(buildPendingAuthorizationKey(scope, state));
  } catch {
    throw new RemoteMcpOAuthError('Could not clear the pending OAuth session');
  }
}

function buildPendingAuthorizationKey(
  scope: CredentialScope,
  state: string,
): string {
  const siteId = normalizeKeyPart(scope.siteId, 'siteId');
  const currentUserId = normalizeKeyPart(scope.currentUserId, 'currentUserId');
  const normalizedState = normalizeKeyPart(state, 'state');

  return `${PENDING_AUTHORIZATION_KEY_PREFIX}:${encodeURIComponent(siteId)}:${encodeURIComponent(currentUserId)}:${encodeURIComponent(normalizedState)}`;
}

function writePendingAuthorization(
  scope: CredentialScope,
  pending: PendingAuthorization,
  storage: Storage,
): void {
  try {
    storage.setItem(
      buildPendingAuthorizationKey(scope, pending.state),
      JSON.stringify(pending),
    );
  } catch {
    throw new RemoteMcpOAuthError('Could not save the pending OAuth session');
  }
}

function parsePendingAuthorization(
  serialized: string,
): PendingAuthorization | null {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return null;
  }

  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !isNonEmptyString(value.state) ||
    !isNonEmptyString(value.codeVerifier) ||
    !isNonEmptyString(value.clientId) ||
    !isFiniteNonNegativeNumber(value.createdAt) ||
    !isFiniteNonNegativeNumber(value.expiresAt)
  ) {
    return null;
  }

  let redirectUri: string;
  try {
    redirectUri = validateRedirectUri(
      isNonEmptyString(value.redirectUri) ? value.redirectUri : '',
    );
  } catch {
    return null;
  }

  return {
    version: 1,
    state: value.state,
    codeVerifier: value.codeVerifier,
    clientId: value.clientId,
    redirectUri,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
  };
}

function isOAuthPopupMessage(value: unknown): value is OAuthPopupMessage {
  if (
    !isRecord(value) ||
    value.type !== OAUTH_POPUP_MESSAGE_TYPE ||
    !isRecord(value.callback) ||
    typeof value.callback.ok !== 'boolean'
  ) {
    return false;
  }

  if (value.callback.ok) {
    return (
      isNonEmptyString(value.callback.code) &&
      isNonEmptyString(value.callback.state)
    );
  }

  return (
    isNonEmptyString(value.callback.error) &&
    (value.callback.errorDescription === undefined ||
      typeof value.callback.errorDescription === 'string') &&
    (value.callback.state === null || typeof value.callback.state === 'string')
  );
}

function randomBytes(length: number, cryptoSource: OAuthCrypto): Uint8Array {
  const bytes = new Uint8Array(length);
  cryptoSource.getRandomValues(bytes);
  return bytes;
}

async function sha256Base64Url(
  input: string,
  cryptoSource: OAuthCrypto,
): Promise<string> {
  const digest = await cryptoSource.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input),
  );
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

async function readJsonObject(
  response: Response,
  action: string,
): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new RemoteMcpOAuthError(`The ${action} response was not valid JSON`);
  }
  if (!isRecord(value)) {
    throw new RemoteMcpOAuthError(
      `The ${action} response had an invalid format`,
    );
  }
  return value;
}

function httpError(action: string, response: Response): RemoteMcpOAuthError {
  return new RemoteMcpOAuthError(
    `${action} failed with HTTP ${response.status}`,
    { status: response.status },
  );
}

function getBrowserFetch(): FetchFunction {
  if (typeof globalThis.fetch !== 'function') {
    throw new RemoteMcpOAuthError('Browser fetch is unavailable');
  }
  return globalThis.fetch.bind(globalThis);
}

function getBrowserCrypto(): OAuthCrypto {
  if (!globalThis.crypto?.subtle) {
    throw new RemoteMcpOAuthError('Browser cryptography is unavailable');
  }
  return globalThis.crypto;
}

function getBrowserSessionStorage(): Storage {
  try {
    if (!globalThis.sessionStorage) {
      throw new Error('sessionStorage is unavailable');
    }
    return globalThis.sessionStorage;
  } catch {
    throw new RemoteMcpOAuthError('Browser session storage is unavailable');
  }
}

function normalizeKeyPart(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new RemoteMcpOAuthError(`${name} must not be empty`);
  }
  return normalized;
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
