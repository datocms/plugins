import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildCredentialStorageKey,
  type CredentialScope,
  createCredentialStore,
  createOAuthCredentials,
  isOAuthClientRegistrationFresh,
  OAUTH_CLIENT_REGISTRATION_SAFETY_MARGIN_MS,
  OAUTH_CLIENT_REGISTRATION_TTL_MS,
  OAUTH_CREDENTIALS_VERSION,
  type OAuthCredentials,
} from './credentials';

const scope: CredentialScope = {
  siteId: 'site/123',
  currentUserId: 'user@example.com',
};

const credentials: OAuthCredentials = createOAuthCredentials(
  {
    clientId: 'mcp_client',
    clientIdIssuedAt: 1_700_000_000,
    redirectUri: 'https://plugin.example/callback',
  },
  {
    accessToken: 'dato_oauth_token',
    tokenType: 'Bearer',
    obtainedAt: 1_700_000_100,
  },
);

describe('createCredentialStore', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('uses localStorage by default', () => {
    const store = createCredentialStore(scope);

    const saved = store.save(credentials);

    expect(saved.persistence).toBe('local');
    expect(store.load()).toEqual({
      credentials,
      persistence: 'local',
    });
    expect(localStorage.getItem(store.key)).not.toBeNull();
    expect(sessionStorage.getItem(store.key)).toBeNull();
  });

  it('uses sessionStorage only after explicit remember opt-out', () => {
    const store = createCredentialStore(scope);

    store.save(credentials, { remember: false });

    expect(store.isRemembered()).toBe(false);
    expect(store.load()?.persistence).toBe('session');
    expect(sessionStorage.getItem(store.key)).not.toBeNull();
    expect(localStorage.getItem(store.key)).toBeNull();
  });

  it('moves credentials between persistence tiers', () => {
    const store = createCredentialStore(scope);
    store.save(credentials, { remember: false });

    expect(store.setRemembered(true)?.persistence).toBe('local');
    expect(sessionStorage.getItem(store.key)).toBeNull();
    expect(localStorage.getItem(store.key)).not.toBeNull();

    expect(store.setRemembered(false)?.persistence).toBe('session');
    expect(sessionStorage.getItem(store.key)).not.toBeNull();
    expect(localStorage.getItem(store.key)).toBeNull();
  });

  it('isolates credentials by site and current user', () => {
    const otherStore = createCredentialStore({
      siteId: scope.siteId,
      currentUserId: 'another-user',
    });
    createCredentialStore(scope).save(credentials);

    expect(otherStore.load()).toBeNull();
  });

  it('removes malformed stored data instead of returning it', () => {
    const store = createCredentialStore(scope);
    sessionStorage.setItem(
      store.key,
      JSON.stringify({
        version: OAUTH_CREDENTIALS_VERSION,
        client: { clientId: 'missing fields' },
      }),
    );

    expect(store.load()).toBeNull();
    expect(sessionStorage.getItem(store.key)).toBeNull();
  });

  it('clears both session and remembered credentials', () => {
    const store = createCredentialStore(scope);
    sessionStorage.setItem(store.key, JSON.stringify(credentials));
    localStorage.setItem(store.key, JSON.stringify(credentials));

    store.clear();

    expect(sessionStorage.getItem(store.key)).toBeNull();
    expect(localStorage.getItem(store.key)).toBeNull();
  });
});

describe('buildCredentialStorageKey', () => {
  it('encodes scope components without leaking into other keys', () => {
    expect(buildCredentialStorageKey(scope)).toBe(
      'dato-agent.oauth.credentials.v1:site%2F123:user%40example.com',
    );
  });

  it('rejects an incomplete scope', () => {
    expect(() =>
      buildCredentialStorageKey({ siteId: '', currentUserId: 'user' }),
    ).toThrow('siteId must not be empty');
  });
});

describe('isOAuthClientRegistrationFresh', () => {
  const issuedAtMs = credentials.client.clientIdIssuedAt * 1000;

  it('accepts a registration before the safety window', () => {
    expect(
      isOAuthClientRegistrationFresh(
        credentials.client,
        issuedAtMs +
          OAUTH_CLIENT_REGISTRATION_TTL_MS -
          OAUTH_CLIENT_REGISTRATION_SAFETY_MARGIN_MS -
          1,
      ),
    ).toBe(true);
  });

  it('treats a registration as stale at the safety window', () => {
    expect(
      isOAuthClientRegistrationFresh(
        credentials.client,
        issuedAtMs +
          OAUTH_CLIENT_REGISTRATION_TTL_MS -
          OAUTH_CLIENT_REGISTRATION_SAFETY_MARGIN_MS,
      ),
    ).toBe(false);
  });
});
