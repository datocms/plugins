import { describe, expect, it } from 'vitest';
import { isSystemicError } from './ProviderErrors';
import type { NormalizedProviderError } from './ProviderErrors';

const err = (code: NormalizedProviderError['code']): NormalizedProviderError => ({
  code,
  source: 'provider',
  message: 'x',
});

describe('isSystemicError', () => {
  it.each(['rate_limit', 'auth', 'quota', 'network'] as const)(
    'treats %s as systemic',
    (code) => expect(isSystemicError(err(code))).toBe(true),
  );

  it.each(['model', 'plugin', 'unknown', 'datocms'] as const)(
    'treats %s as content-scoped',
    (code) => expect(isSystemicError(err(code))).toBe(false),
  );
});
