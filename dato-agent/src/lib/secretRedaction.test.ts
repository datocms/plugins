import { describe, expect, it } from 'vitest';
import { redactCredentialTokens, redactSecrets } from './secretRedaction';

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
});
