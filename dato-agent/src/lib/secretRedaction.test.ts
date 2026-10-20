import { describe, expect, it } from 'vitest';
import {
  isSecretParameterName,
  redactCredentialTokens,
  redactSecrets,
} from './secretRedaction';

describe('secretRedaction', () => {
  it('redacts Bearer tokens and sk- keys with one marker', () => {
    expect(
      redactCredentialTokens(
        'Authorization: Bearer abc.def-ghi with sk-proj-123456789012',
      ),
    ).toBe('Authorization: Bearer [redacted] with [redacted]');
  });

  it('leaves key=value content alone in the token-only pass', () => {
    expect(redactCredentialTokens('token: ordinary-record-value')).toBe(
      'token: ordinary-record-value',
    );
  });

  it('redacts URL query secrets but keeps sibling parameters', () => {
    expect(
      redactSecrets(
        'https://x.test/?api_key=k1&access_token=t1&client_secret=s1&page=2',
      ),
    ).toBe(
      'https://x.test/?api_key=[redacted]&access_token=[redacted]&client_secret=[redacted]&page=2',
    );
  });

  it('does not double-redact an already redacted Bearer header', () => {
    expect(redactSecrets('Authorization: Bearer abcdefgh')).toBe(
      'Authorization: Bearer [redacted]',
    );
  });

  it('redacts the credential after a non-Bearer Authorization scheme', () => {
    expect(redactSecrets('Authorization: Basic dXNlcjpwYXNzd29yZA==')).toBe(
      'Authorization: Basic [redacted]',
    );
    expect(redactSecrets('{"authorization":"Digest abc123secret"}')).toBe(
      '{"authorization":"Digest [redacted]"}',
    );
    expect(redactSecrets('Authorization: opaque-secret-value')).toBe(
      'Authorization: [redacted]',
    );
  });

  it('redacts quoted values up to the closing quote', () => {
    expect(redactSecrets('{"password":"two words here","user":"ann"}')).toBe(
      '{"password":"[redacted]","user":"ann"}',
    );
    expect(redactSecrets("secret: 'with \\' escaped quote' done")).toBe(
      "secret: '[redacted]' done",
    );
  });

  it('keeps non-secret keys that only resemble secret ones', () => {
    expect(redactSecrets('maxTokens: 64000, tokenType: Bearer')).toBe(
      'maxTokens: 64000, tokenType: Bearer',
    );
  });

  it('redacts a quoted value whose closing quote was truncated', () => {
    expect(redactSecrets('{"password":"abc')).toBe('{"password":"[redacted]');
    expect(redactSecrets('{"token":"abc def\nnext line')).toBe(
      '{"token":"[redacted]\nnext line',
    );
  });

  it('redacts an unknown Authorization scheme through the end of the line', () => {
    expect(redactSecrets('Authorization: Key abc123\nAccept: */*')).toBe(
      'Authorization: [redacted]\nAccept: */*',
    );
    expect(redactSecrets('Authorization: Basic abc123 trailing')).toBe(
      'Authorization: Basic [redacted] trailing',
    );
  });

  it('redacts quoted values across newlines up to the closing quote', () => {
    expect(
      redactSecrets(
        'password: "-----BEGIN KEY-----\nMIIabc\n-----END KEY-----" next',
      ),
    ).toBe('password: "[redacted]" next');
  });

  it('redacts every word before an already redacted token', () => {
    expect(redactSecrets('password: hunter2 sk-abcdefghijklmnopqrst')).toBe(
      'password: [redacted] [redacted]',
    );
  });

  it('never treats a value on the next line as the secret', () => {
    expect(redactSecrets('token:\nnext: 1')).toBe('token:\nnext: 1');
  });

  it('redacts values in double-encoded JSON', () => {
    expect(redactSecrets('{\\"api_key\\":\\"abc\\",\\"x\\":1}')).toBe(
      '{\\"api_key\\":\\"[redacted]\\",\\"x\\":1}',
    );
  });

  it('skips escaped quotes inside a double-encoded value', () => {
    const doubleEncoded = JSON.stringify(
      JSON.stringify({ password: 'ab"cd-SECRET', next: 1 }),
    );
    const redacted = redactSecrets(doubleEncoded);

    expect(redacted).not.toContain('SECRET');
    expect(redacted).toContain('next');
  });

  it.each([
    ['NBSP', '\u00a0'],
    ['ideographic space', '\u3000'],
  ])('accepts %s around the separator', (_label, space) => {
    expect(redactSecrets(`password:${space}hunter2`)).toBe(
      `password:${space}[redacted]`,
    );
  });

  it('redacts a whole bracketed value', () => {
    expect(
      redactSecrets(
        '{"password": {"value":"hunter2","note":"a } in a string"}, "user":"ann"}',
      ),
    ).toBe('{"password": [redacted], "user":"ann"}');
    expect(redactSecrets('secret=[1, [2, "x]"]] tail')).toBe(
      'secret=[redacted] tail',
    );
  });

  it('redacts an unbalanced bracketed value to the end of the line', () => {
    expect(redactSecrets('token: {"value":"abc"\nnext: 1')).toBe(
      'token: [redacted]\nnext: 1',
    );
  });

  it('still balances later bracketed values after an unbalanced one', () => {
    const redacted = redactSecrets(
      'password: { broken\n"secret": {\n  "value": "SECRET2"\n}\nnext: 1',
    );

    expect(redacted).not.toContain('SECRET2');
    expect(redacted).toContain('next: 1');
  });

  it.each([1, 2, 3])('redacts JSON encoded %i extra time(s)', (depth) => {
    let encoded = JSON.stringify({ password: 'ab"cd-SECRET\\', next: 1 });
    for (let level = 0; level < depth; level += 1) {
      encoded = JSON.stringify(encoded);
    }
    const redacted = redactSecrets(encoded);

    expect(redacted).not.toContain('SECRET');
    expect(redacted).toContain('next');
  });

  it.each([
    ['long backslash runs', `password: ${'\\'.repeat(100_000)}`],
    ['many backslash-quote keys', 'token\\\\:"x '.repeat(20_000)],
    ['many unbalanced brackets', 'token: { '.repeat(30_000)],
    [
      'many escaped-quote candidates',
      `\\"token\\":\\"${'\\\\\\"'.repeat(30_000)}`,
    ],
    ['whitespace after a key', `token:${' '.repeat(100_000)}`],
    ['whitespace after authorization', `authorization:${' '.repeat(100_000)}`],
    ['many bare values on one line', 'token: a '.repeat(30_000)],
    ['many unterminated quotes', 'password:"x '.repeat(30_000)],
    ['many unknown auth values', 'authorization: [redacted] '.repeat(10_000)],
  ])('stays linear-time on %s', (_label, input) => {
    const startedAt = performance.now();
    redactSecrets(input);
    expect(performance.now() - startedAt).toBeLessThan(50);
  });
});

describe('isSecretParameterName', () => {
  it.each(['token', 'preview_token', 'secret', 'apiKey', 'x-auth', 'sig'])(
    'treats %s as secret',
    (name) => {
      expect(isSecretParameterName(name)).toBe(true);
    },
  );

  it.each(['url', 'slug', 'locale', 'redirect'])('keeps %s visible', (name) => {
    expect(isSecretParameterName(name)).toBe(false);
  });
});
