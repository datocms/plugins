import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  copyTextToClipboard,
  DIAGNOSTICS_SCHEMA_VERSION,
  serializeDiagnostics,
} from './diagnostics';

function setClipboard(
  value: { writeText: (text: string) => unknown } | undefined,
) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value,
  });
}

function setExecCommand(value: ((command: string) => boolean) | undefined) {
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value,
  });
}

afterEach(() => {
  setClipboard(undefined);
  setExecCommand(undefined);
  document.body.replaceChildren();
});

describe('serializeDiagnostics', () => {
  it('redacts Web Previews custom header values in the configuration', () => {
    const serialized = serializeDiagnostics({
      configuration: {
        previewFrontends: [
          {
            name: 'Production',
            apiEndpointUrl: 'https://example.com/api/preview-links',
            customHeaders: [
              { name: 'X-Preview-Key', value: 'header-secret-1' },
              { name: 'Cookie-Ish', value: 'header-secret-2' },
              { name: 'X-Empty', value: '' },
            ],
          },
        ],
      },
    });

    expect(serialized).not.toContain('header-secret-1');
    expect(serialized).not.toContain('header-secret-2');
    expect(serialized).toContain('"name": "X-Preview-Key"');
    expect(serialized).toContain('"value": "[redacted]"');
    expect(serialized).toContain('"value": ""');
  });

  it('produces deterministic pretty JSON with credentials redacted', () => {
    const first = {
      token: 'dato_oauth_secret',
      schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
      prompt: 'Change record 178178740',
      arguments: { z: true, apiKey: 'sk-secret', a: false },
    };
    const second = {
      arguments: { a: false, apiKey: 'sk-secret', z: true },
      prompt: 'Change record 178178740',
      schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
      token: 'dato_oauth_secret',
    };

    expect(serializeDiagnostics(first)).toBe(serializeDiagnostics(second));
    expect(serializeDiagnostics(first)).toBe(`{
  "arguments": {
    "a": false,
    "apiKey": "[redacted]",
    "z": true
  },
  "prompt": "Change record 178178740",
  "schemaVersion": 1,
  "token": "[redacted]"
}`);
  });

  it('redacts provider keys and OAuth credentials while keeping non-secret settings', () => {
    const serialized = serializeDiagnostics({
      configuration: {
        anthropicApiKey: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz',
        openaiApiKey: '',
        activeApiKey: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz',
        anthropicModelMaxOutputTokens: 128_000,
        oauthCredentials: {
          client: { clientId: 'client-123' },
          token: {
            accessToken: 'dato-access-token-value',
            refreshToken: 'dato-refresh-token-value',
            expiresAt: 1_800_000_000,
          },
          pending: { codeVerifier: 'pkce-verifier-value', state: 'abc' },
        },
      },
      turn: { mcpAccessToken: 'dato-access-token-value' },
      error: {
        message:
          'Request failed: Authorization: Bearer dato-access-token-value with key sk-proj-abcdefghijklmnopqrstuvwxyz',
      },
    });

    expect(serialized).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(serialized).not.toContain('dato-access-token-value');
    expect(serialized).not.toContain('dato-refresh-token-value');
    expect(serialized).not.toContain('pkce-verifier-value');
    expect(JSON.parse(serialized)).toMatchObject({
      configuration: {
        anthropicApiKey: '[redacted]',
        openaiApiKey: '',
        activeApiKey: '[redacted]',
        anthropicModelMaxOutputTokens: 128_000,
        oauthCredentials: {
          client: { clientId: 'client-123' },
          token: {
            accessToken: '[redacted]',
            refreshToken: '[redacted]',
            expiresAt: 1_800_000_000,
          },
          pending: { codeVerifier: '[redacted]', state: 'abc' },
        },
      },
      error: {
        message:
          'Request failed: Authorization: Bearer [redacted] with key [redacted]',
      },
    });
  });

  it('redacts secrets in real Error message, stack, and cause', () => {
    const cause = new Error(
      'Upstream rejected Authorization: Bearer cause-bearer-secret',
    );
    const error = new Error(
      'Request to https://example.test/hook?access_token=url-token-secret&page=1 failed with key sk-proj-abcdefghijklmnopqrstuvwxyz',
      { cause },
    );

    const serialized = serializeDiagnostics({ error });
    const parsed = JSON.parse(serialized);

    for (const secret of [
      'cause-bearer-secret',
      'url-token-secret',
      'abcdefghijklmnopqrstuvwxyz',
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(parsed.error.message).toBe(
      'Request to https://example.test/hook?access_token=[redacted]&page=1 failed with key [redacted]',
    );
    expect(parsed.error.stack).toContain('access_token=[redacted]');
    expect(parsed.error.cause.message).toBe(
      'Upstream rejected Authorization: Bearer [redacted]',
    );
  });

  it('redacts sensitive Map entries by key', () => {
    const parsed = JSON.parse(
      serializeDiagnostics({
        headers: new Map<unknown, unknown>([
          ['Authorization', 'opaque-header-secret'],
          ['x-api-key', 'opaque-api-secret'],
          ['accept', 'application/json'],
          [42, 'numeric-key-value'],
        ]),
      }),
    );

    expect(parsed.headers.entries).toEqual([
      ['Authorization', '[redacted]'],
      ['x-api-key', '[redacted]'],
      ['accept', 'application/json'],
      [42, 'numeric-key-value'],
    ]);
  });

  it('redacts secret-like keys in any casing or separator style', () => {
    const parsed = JSON.parse(
      serializeDiagnostics({
        apiToken: 'v-api-token',
        authToken: 'v-auth-token',
        sessionToken: 'v-session-token',
        privateKey: 'v-private-key',
        api_key: 'v-api-key',
        CLIENT_SECRET: 'v-client-secret',
        'set-cookie': 'v-cookie',
        headers: new Map([['x-auth-token', 'v-x-auth-token']]),
      }),
    );

    expect(JSON.stringify(parsed)).not.toMatch(/"v-/);
    expect(parsed.headers.entries).toEqual([['x-auth-token', '[redacted]']]);
  });

  it('keeps harmless keys that only resemble secret ones', () => {
    const harmless = {
      itemTypeKey: 'article',
      modelApiKey: 'blog_post',
      fieldApiKey: 'title',
      anthropicModelMaxOutputTokens: 64_000,
      tokenType: 'Bearer',
      cacheKey: 'v1:record:1',
      textDeltaCount: 2,
    };

    expect(JSON.parse(serializeDiagnostics(harmless))).toEqual(harmless);
  });

  it('redacts key=value secrets embedded in URLs and strings', () => {
    const parsed = JSON.parse(
      serializeDiagnostics({
        url: 'https://example.test/cb?code=abc&access_token=query-secret&api_key=other-secret',
        note: 'password: hunter2-secret',
      }),
    );

    expect(parsed.url).toBe(
      'https://example.test/cb?code=abc&access_token=[redacted]&api_key=[redacted]',
    );
    expect(parsed.note).toBe('password: [redacted]');
  });

  it('handles errors, BigInt, Map, Set, circular references, and unsupported values', () => {
    const cause = new Error('Provider request failed');
    const error = new Error('Turn failed', { cause });
    Object.assign(error, { status: 500n });

    const diagnostics: Record<string, unknown> = {
      error,
      map: new Map<unknown, unknown>([['request', { recordId: 'record-1' }]]),
      set: new Set(['one', 'two']),
      missing: undefined,
      callback: function retryTurn() {},
      symbol: Symbol('private'),
      notANumber: Number.NaN,
      infinity: Number.POSITIVE_INFINITY,
    };
    diagnostics.circular = diagnostics;

    const parsed = JSON.parse(serializeDiagnostics(diagnostics));

    expect(parsed.error).toMatchObject({
      $type: 'Error',
      name: 'Error',
      message: 'Turn failed',
      cause: {
        $type: 'Error',
        name: 'Error',
        message: 'Provider request failed',
      },
      status: '500n',
    });
    expect(parsed.error.stack).toContain('Turn failed');
    expect(parsed.map).toEqual({
      $type: 'Map',
      entries: [['request', { recordId: 'record-1' }]],
    });
    expect(parsed.set).toEqual({
      $type: 'Set',
      values: ['one', 'two'],
    });
    expect(parsed).toMatchObject({
      callback: '[Function retryTurn]',
      circular: '[Circular $]',
      infinity: '[Infinity]',
      missing: '[undefined]',
      notANumber: '[NaN]',
      symbol: '[Symbol(private)]',
    });
  });

  it('does not throw for values whose properties cannot be inspected', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    expect(() => serializeDiagnostics(proxy)).not.toThrow();
    expect(serializeDiagnostics(proxy)).toContain('[Unserializable:');
  });
});

describe('copyTextToClipboard', () => {
  it('uses the Clipboard API when it is available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const execCommand = vi.fn(() => true);
    setClipboard({ writeText });
    setExecCommand(execCommand);

    await copyTextToClipboard('full diagnostics');

    expect(writeText).toHaveBeenCalledWith('full diagnostics');
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('falls back to an iframe-local textarea and restores focus', async () => {
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();

    const writeText = vi.fn().mockRejectedValue(new Error('Not allowed'));
    const execCommand = vi.fn((command: string) => {
      const textarea = document.querySelector('textarea');
      expect(command).toBe('copy');
      expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
      expect(textarea).toHaveValue('raw token: secret');
      expect(textarea).toHaveAttribute('readonly');
      return true;
    });
    setClipboard({ writeText });
    setExecCommand(execCommand);

    await copyTextToClipboard('raw token: secret');

    expect(execCommand).toHaveBeenCalledOnce();
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('throws and still cleans up when both copy mechanisms fail', async () => {
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();

    setClipboard({
      writeText: vi.fn().mockRejectedValue(new Error('Not allowed')),
    });
    setExecCommand(vi.fn(() => false));

    await expect(copyTextToClipboard('diagnostics')).rejects.toThrow(
      'Could not copy diagnostics to the clipboard',
    );
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});
