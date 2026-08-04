import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CredentialScope } from './credentials';
import {
  computeRedirectUri,
  createAuthorizationRequest,
  exchangeAuthorizationCode,
  type FetchFunction,
  MCP_BASE_URL,
  OAUTH_POPUP_MESSAGE_TYPE,
  type OAuthPopupMessage,
  openOAuthPopup,
  PENDING_AUTHORIZATION_TTL_MS,
  parseOAuthCallback,
  postOAuthCallbackToOpener,
  registerClient,
  revokeToken,
  validateRedirectUri,
  waitForOAuthCallback,
} from './oauth';

const scope: CredentialScope = {
  siteId: 'site-1',
  currentUserId: 'user-1',
};

describe('OAuth redirect URI', () => {
  it('computes a callback without the current query or fragment', () => {
    expect(
      computeRedirectUri({
        origin: 'https://plugin.example',
        pathname: '/index.html',
      }),
    ).toBe('https://plugin.example/index.html');
  });

  it('rejects query strings and fragments', () => {
    expect(() =>
      validateRedirectUri('https://plugin.example/callback?mode=oauth'),
    ).toThrow('must not contain a query string or fragment');
    expect(() =>
      validateRedirectUri('https://plugin.example/callback#oauth'),
    ).toThrow('must not contain a query string or fragment');
  });

  it('allows HTTP only for local development', () => {
    expect(validateRedirectUri('http://localhost:3000/callback')).toBe(
      'http://localhost:3000/callback',
    );
    expect(() => validateRedirectUri('http://plugin.example/callback')).toThrow(
      'must use HTTPS',
    );
  });
});

describe('registerClient', () => {
  it('registers an OAuth public client using DCR', async () => {
    const fetchMock = vi.fn<FetchFunction>().mockResolvedValue(
      Response.json({
        client_id: 'mcp_public_client',
        client_id_issued_at: 123,
      }),
    );

    const client = await registerClient('https://plugin.example/callback', {
      fetch: fetchMock,
    });

    expect(client).toEqual({
      clientId: 'mcp_public_client',
      clientIdIssuedAt: 123,
      redirectUri: 'https://plugin.example/callback',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${MCP_BASE_URL}/register`);
    expect(JSON.parse(String(init?.body))).toMatchObject({
      redirect_uris: ['https://plugin.example/callback'],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
  });

  it('does not include a response body that could contain secrets in errors', async () => {
    const fetchMock = vi
      .fn<FetchFunction>()
      .mockResolvedValue(
        new Response('reflected-secret-token', { status: 400 }),
      );

    await expect(
      registerClient('https://plugin.example/callback', {
        fetch: fetchMock,
      }),
    ).rejects.not.toThrow('reflected-secret-token');
  });
});

describe('authorization request and token exchange', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('creates a cryptographic state and correct PKCE S256 challenge', async () => {
    const request = await createAuthorizationRequest(
      {
        scope,
        clientId: 'mcp_public_client',
        redirectUri: 'https://plugin.example/callback',
      },
      { now: () => 1_000 },
    );
    const url = new URL(request.authorizationUrl);

    expect(url.origin).toBe(MCP_BASE_URL);
    expect(url.pathname).toBe('/authorize');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(request.state).toHaveLength(43);
    expect(request.expiresAt).toBe(1_000 + PENDING_AUTHORIZATION_TTL_MS);

    const fetchMock = vi.fn<FetchFunction>().mockResolvedValue(
      Response.json({
        access_token: 'dato_access_token',
        token_type: 'Bearer',
      }),
    );
    await exchangeAuthorizationCode(
      { scope, code: 'one_time_code', state: request.state },
      {
        fetch: fetchMock,
        now: () => 2_000,
      },
    );

    const [, tokenInit] = fetchMock.mock.calls[0];
    const body = new URLSearchParams(String(tokenInit?.body));
    const verifier = body.get('code_verifier');
    expect(verifier).toHaveLength(43);
    const expectedChallenge = await sha256Base64Url(String(verifier));
    expect(url.searchParams.get('code_challenge')).toBe(expectedChallenge);
  });

  it('validates and consumes the five-minute pending session', async () => {
    const request = await createAuthorizationRequest(
      {
        scope,
        clientId: 'mcp_public_client',
        redirectUri: 'https://plugin.example/callback',
      },
      { now: () => 10 },
    );
    const fetchMock = vi.fn<FetchFunction>();

    await expect(
      exchangeAuthorizationCode(
        { scope, code: 'code', state: request.state },
        {
          fetch: fetchMock,
          now: () => 10 + PENDING_AUTHORIZATION_TTL_MS,
        },
      ),
    ).rejects.toThrow('OAuth session expired');
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(
      exchangeAuthorizationCode(
        { scope, code: 'code', state: request.state },
        { fetch: fetchMock, now: () => 20 },
      ),
    ).rejects.toThrow('missing or has already been used');
  });

  it('sends the pending client, verifier, redirect URI, and code', async () => {
    const request = await createAuthorizationRequest({
      scope,
      clientId: 'mcp_public_client',
      redirectUri: 'https://plugin.example/callback',
    });
    const fetchMock = vi
      .fn<FetchFunction>()
      .mockResolvedValue(Response.json({ access_token: 'dato_access_token' }));

    const token = await exchangeAuthorizationCode(
      {
        scope,
        code: 'one_time_code',
        state: request.state,
      },
      { fetch: fetchMock, now: () => 2_000 },
    );

    expect(token).toEqual({
      accessToken: 'dato_access_token',
      tokenType: 'Bearer',
      obtainedAt: 2_000,
    });
    const [url, init] = fetchMock.mock.calls[0];
    const body = new URLSearchParams(String(init?.body));
    expect(url).toBe(`${MCP_BASE_URL}/token`);
    expect(Object.fromEntries(body)).toMatchObject({
      grant_type: 'authorization_code',
      code: 'one_time_code',
      client_id: 'mcp_public_client',
      redirect_uri: 'https://plugin.example/callback',
    });
    expect(body.get('code_verifier')).toBeTruthy();
  });

  it('does not let another user or project consume the pending state', async () => {
    const request = await createAuthorizationRequest({
      scope,
      clientId: 'mcp_public_client',
      redirectUri: 'https://plugin.example/callback',
    });
    const fetchMock = vi.fn<FetchFunction>();

    await expect(
      exchangeAuthorizationCode(
        {
          scope: { siteId: 'another-site', currentUserId: scope.currentUserId },
          code: 'one_time_code',
          state: request.state,
        },
        { fetch: fetchMock },
      ),
    ).rejects.toThrow('missing or has already been used');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

async function sha256Base64Url(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  );
  let binary = '';
  for (const byte of digest) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

describe('OAuth popup callback', () => {
  it('parses success, errors, and unrelated URLs', () => {
    expect(
      parseOAuthCallback(
        'https://plugin.example/callback?code=abc&state=state',
      ),
    ).toEqual({ ok: true, code: 'abc', state: 'state' });
    expect(
      parseOAuthCallback(
        'https://plugin.example/callback?error=access_denied&error_description=No&state=state',
      ),
    ).toEqual({
      ok: false,
      error: 'access_denied',
      errorDescription: 'No',
      state: 'state',
    });
    expect(parseOAuthCallback('https://plugin.example/callback')).toBeNull();
  });

  it('posts callback data only to the callback origin', () => {
    const postMessage = vi.fn();
    const close = vi.fn();
    const schedule = vi.fn((callback: () => void) => callback());

    expect(
      postOAuthCallbackToOpener({
        url: 'https://plugin.example/callback?code=abc&state=state',
        opener: { postMessage },
        close,
        schedule,
      }),
    ).toBe(true);

    expect(postMessage).toHaveBeenCalledWith(
      {
        type: OAUTH_POPUP_MESSAGE_TYPE,
        callback: { ok: true, code: 'abc', state: 'state' },
      },
      'https://plugin.example',
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it('opens a blank popup synchronously', () => {
    const popup = {} as Window;
    const open = vi.fn().mockReturnValue(popup);

    expect(openOAuthPopup({ hostWindow: { open } })).toBe(popup);
    expect(open).toHaveBeenCalledWith(
      'about:blank',
      'dato-agent-oauth',
      expect.stringContaining('width=520'),
    );
  });

  it('accepts callback messages only from the popup and expected state', async () => {
    const popup = {
      closed: false,
      close: vi.fn(),
    } as unknown as Window;
    const resultPromise = waitForOAuthCallback(popup, 'expected-state', {
      callbackOrigin: 'https://plugin.example',
      timeoutMs: 1_000,
    });
    const message: OAuthPopupMessage = {
      type: OAUTH_POPUP_MESSAGE_TYPE,
      callback: {
        ok: true,
        code: 'authorization-code',
        state: 'expected-state',
      },
    };

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://plugin.example',
        source: popup,
        data: message,
      }),
    );

    await expect(resultPromise).resolves.toEqual({
      code: 'authorization-code',
      state: 'expected-state',
    });
    expect(popup.close).toHaveBeenCalledOnce();
  });

  it('rejects a callback whose cryptographic state does not match', async () => {
    const popup = {
      closed: false,
      close: vi.fn(),
    } as unknown as Window;
    const resultPromise = waitForOAuthCallback(popup, 'expected-state', {
      callbackOrigin: 'https://plugin.example',
      timeoutMs: 1_000,
    });
    const message: OAuthPopupMessage = {
      type: OAUTH_POPUP_MESSAGE_TYPE,
      callback: {
        ok: true,
        code: 'authorization-code',
        state: 'attacker-state',
      },
    };

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://plugin.example',
        source: popup,
        data: message,
      }),
    );

    await expect(resultPromise).rejects.toThrow('OAuth state mismatch');
    expect(popup.close).toHaveBeenCalledOnce();
  });
});

describe('revokeToken', () => {
  it('revokes the token using the public client ID', async () => {
    const fetchMock = vi
      .fn<FetchFunction>()
      .mockResolvedValue(new Response(null, { status: 200 }));

    await revokeToken(
      {
        accessToken: 'dato_access_token',
        clientId: 'mcp_public_client',
      },
      { fetch: fetchMock },
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${MCP_BASE_URL}/revoke`);
    expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual(
      {
        token: 'dato_access_token',
        client_id: 'mcp_public_client',
      },
    );
  });
});
