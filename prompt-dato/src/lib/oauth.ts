/**
 * Browser-side OAuth 2.1 + PKCE client for the DatoCMS hosted MCP server at
 * https://mcp.datocms.com/. The server exposes RFC 7591 dynamic client
 * registration and standard /authorize, /token, /revoke endpoints (with CORS
 * enabled by the @modelcontextprotocol/sdk auth router).
 */

import { derror, dlog, shortPrefix } from './debugLog';

export const MCP_BASE_URL = 'https://mcp.datocms.com';
export const OAUTH_SCOPES = 'read_account read_sites read_organizations';
export const OAUTH_POPUP_MESSAGE_TYPE = 'promptDato.oauth';

const PKCE_SESSION_PREFIX = 'promptDato.pkce.';

type PkceState = { verifier: string; redirectUri: string };

export type OAuthCallbackMessage = {
  type: typeof OAUTH_POPUP_MESSAGE_TYPE;
  code: string | null;
  state: string | null;
  error: string | null;
};

export function computeRedirectUri(): string {
  // No query-string marker on purpose: the MCP server's callback handler
  // appends `?code=...&state=...` without checking for a pre-existing `?`,
  // which would produce a malformed URL. We instead detect the callback in
  // `handleOAuthCallbackIfPresent()` by combining `window.opener` (set on the
  // popup, null on the plugin iframe) with the presence of `code` + `state`.
  const { origin, pathname } = window.location;
  return `${origin}${pathname}`;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function randomBytes(length: number): Uint8Array {
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  return buf;
}

async function sha256Base64Url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

export type RegisteredClient = {
  clientId: string;
  clientIdIssuedAt: number;
  redirectUri: string;
};

export async function registerClient(
  redirectUri: string,
): Promise<RegisteredClient> {
  dlog('OAuth', 'register_client:start', { redirectUri });
  const response = await fetch(`${MCP_BASE_URL}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'DatoCMS Prompt Dato Plugin',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: OAUTH_SCOPES,
    }),
  });

  if (!response.ok) {
    const body = await safeText(response);
    const error = new Error(
      `Dynamic client registration failed (${response.status}): ${body}`,
    );
    derror('OAuth', 'register_client:failure', error, {
      status: response.status,
      bodyPreview: body.slice(0, 200),
    });
    throw error;
  }

  const data = (await response.json()) as {
    client_id?: string;
    client_id_issued_at?: number;
  };

  if (!data.client_id) {
    const error = new Error('Registration response missing client_id');
    derror('OAuth', 'register_client:malformed', error, {
      receivedKeys: Object.keys(data),
    });
    throw error;
  }

  const result: RegisteredClient = {
    clientId: data.client_id,
    clientIdIssuedAt:
      typeof data.client_id_issued_at === 'number'
        ? data.client_id_issued_at
        : Math.floor(Date.now() / 1000),
    redirectUri,
  };
  dlog('OAuth', 'register_client:success', {
    clientId: result.clientId,
    issuedAt: result.clientIdIssuedAt,
  });
  return result;
}

/**
 * Opens a blank popup synchronously — must be called directly from a user
 * gesture (click handler) so the popup blocker doesn't kill it. The caller
 * later sets `popup.location.href` to the authorize URL.
 */
export function openBlankPopup(name = 'datocms-oauth'): Window {
  const popup = window.open(
    'about:blank',
    name,
    'width=520,height=720,menubar=no,toolbar=no,location=no,status=no',
  );

  if (!popup) {
    throw new Error(
      'Popup was blocked. Please allow popups for this page and try again.',
    );
  }

  return popup;
}

export type AuthorizeFlow = {
  authorizeUrl: string;
  state: string;
};

/**
 * Generates PKCE verifier+challenge, stashes the verifier in sessionStorage
 * keyed by the OAuth `state`, and returns the authorize URL the popup should
 * navigate to.
 */
export async function buildAuthorizeFlow(args: {
  clientId: string;
  redirectUri: string;
}): Promise<AuthorizeFlow> {
  const verifier = base64UrlEncode(randomBytes(32));
  const challenge = await sha256Base64Url(verifier);
  const state = base64UrlEncode(randomBytes(16));

  const pkce: PkceState = { verifier, redirectUri: args.redirectUri };
  sessionStorage.setItem(
    `${PKCE_SESSION_PREFIX}${state}`,
    JSON.stringify(pkce),
  );

  const params = new URLSearchParams({
    client_id: args.clientId,
    response_type: 'code',
    redirect_uri: args.redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    scope: OAUTH_SCOPES,
  });

  const authorizeUrl = `${MCP_BASE_URL}/authorize?${params.toString()}`;
  dlog('OAuth', 'authorize_url_built', {
    clientId: args.clientId,
    redirectUri: args.redirectUri,
    state,
    codeChallengeMethod: 'S256',
  });
  return { authorizeUrl, state };
}

export type WaitForOAuthCallbackResult = {
  code: string;
  state: string;
};

export function waitForOAuthCallback(
  popup: Window,
  expectedState: string,
): Promise<WaitForOAuthCallbackResult> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      clearInterval(closedPoller);
    };

    const settle = (
      action: () => void,
      finalize: () => void = () => {
        if (!popup.closed) popup.close();
      },
    ) => {
      if (settled) return;
      settled = true;
      cleanup();
      finalize();
      action();
    };

    const onMessage = (event: MessageEvent<OAuthCallbackMessage>) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.type !== OAUTH_POPUP_MESSAGE_TYPE) return;

      if (data.error) {
        dlog('OAuth', 'callback:error', { error: data.error });
        settle(
          () => reject(new Error(`OAuth error: ${data.error}`)),
          () => {},
        );
        return;
      }
      if (!data.code || !data.state) {
        dlog('OAuth', 'callback:malformed', {
          codePresent: Boolean(data.code),
          statePresent: Boolean(data.state),
        });
        settle(() =>
          reject(new Error('OAuth callback missing code or state')),
        );
        return;
      }
      if (data.state !== expectedState) {
        dlog('OAuth', 'callback:state_mismatch', {
          expectedPrefix: shortPrefix(expectedState),
          receivedPrefix: shortPrefix(data.state),
        });
        settle(() => reject(new Error('OAuth state mismatch')));
        return;
      }
      dlog('OAuth', 'callback:received', {
        codePrefix: shortPrefix(data.code),
        statePrefix: shortPrefix(data.state),
      });
      settle(() => resolve({ code: data.code as string, state: data.state as string }));
    };

    window.addEventListener('message', onMessage);

    const closedPoller = window.setInterval(() => {
      if (popup.closed) {
        settle(
          () => reject(new Error('OAuth popup was closed before completion')),
          () => {},
        );
      }
    }, 400);
  });
}

export async function exchangeCodeForToken(args: {
  code: string;
  state: string;
  clientId: string;
}): Promise<{ accessToken: string }> {
  dlog('OAuth', 'token_exchange:start', {
    clientId: args.clientId,
    statePrefix: shortPrefix(args.state),
    codePrefix: shortPrefix(args.code),
  });

  const stored = sessionStorage.getItem(`${PKCE_SESSION_PREFIX}${args.state}`);
  if (!stored) {
    const error = new Error('Missing PKCE verifier for this state');
    derror('OAuth', 'token_exchange:no_verifier', error, {
      statePrefix: shortPrefix(args.state),
    });
    throw error;
  }
  sessionStorage.removeItem(`${PKCE_SESSION_PREFIX}${args.state}`);

  const pkce = JSON.parse(stored) as PkceState;

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: args.code,
    client_id: args.clientId,
    code_verifier: pkce.verifier,
    redirect_uri: pkce.redirectUri,
  });

  const response = await fetch(`${MCP_BASE_URL}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await safeText(response);
    const error = new Error(
      `Token exchange failed (${response.status}): ${text}`,
    );
    derror('OAuth', 'token_exchange:failure', error, {
      status: response.status,
      bodyPreview: text.slice(0, 200),
    });
    throw error;
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    const error = new Error('Token response missing access_token');
    derror('OAuth', 'token_exchange:malformed', error, {
      receivedKeys: Object.keys(data),
    });
    throw error;
  }
  dlog('OAuth', 'token_exchange:success', {
    tokenPresent: true,
    tokenLength: data.access_token.length,
  });
  return { accessToken: data.access_token };
}

export async function revokeToken(args: {
  token: string;
  clientId: string;
}): Promise<void> {
  dlog('OAuth', 'revoke_token:start', {
    clientId: args.clientId,
    tokenLength: args.token.length,
  });
  const body = new URLSearchParams({
    token: args.token,
    client_id: args.clientId,
  });

  const response = await fetch(`${MCP_BASE_URL}/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  // Per RFC 7009, revoke endpoints return 200 even for unknown tokens. Still,
  // log non-2xx for visibility — never throw, since the user-visible action
  // (forgetting the token locally) should always succeed.
  if (!response.ok) {
    dlog('OAuth', 'revoke_token:non_ok', { status: response.status });
  } else {
    dlog('OAuth', 'revoke_token:success', { status: response.status });
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '<unreadable response body>';
  }
}

/**
 * Detect whether the current page load is the OAuth popup callback. Called
 * from main.tsx before connect() — if this returns true, post the code to the
 * opener and close the popup; do not boot the plugin SDK.
 *
 * Detection: we treat the page as a callback when `window.opener` is set
 * (popups have it; the DatoCMS plugin iframe does not) AND the URL carries
 * either an OAuth `code`/`state` pair or an `error`. We deliberately avoid a
 * query-string marker on the redirect_uri because the MCP server's callback
 * handler concatenates `?code=...` to the redirect_uri without checking for
 * an existing `?`, which would corrupt the URL.
 */
export function handleOAuthCallbackIfPresent(): boolean {
  if (!window.opener) return false;

  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (!error && !(code && state)) return false;

  const message: OAuthCallbackMessage = {
    type: OAUTH_POPUP_MESSAGE_TYPE,
    code,
    state,
    error,
  };

  dlog('OAuth', 'popup_callback:posting', {
    codePrefix: shortPrefix(code),
    statePrefix: shortPrefix(state),
    errorPresent: Boolean(error),
  });

  try {
    window.opener.postMessage(message, window.location.origin);
  } catch (postError) {
    derror('OAuth', 'popup_callback:post_failed', postError);
  }

  // Give the opener a tick to receive the message before we close.
  window.setTimeout(() => window.close(), 50);
  return true;
}
