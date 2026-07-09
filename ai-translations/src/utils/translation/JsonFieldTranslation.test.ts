/**
 * Tests for structural JSON field translation. Regression for the pt-BR 422:
 * sending the raw JSON document to the provider as plain text let it translate
 * KEYS and mangle syntax (`"estimatedMinutes": 8` → `"tempo estimado": 8
 * minutos`), producing an invalid value that DatoCMS rejected at save time.
 * Only string VALUES may be translated; keys, numbers, booleans, and structure
 * must survive byte-exact, and the output must always re-parse.
 */

import { describe, expect, it, vi } from 'vitest';
import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';
import { translateJsonFieldValue } from './JsonFieldTranslation';
import type { QcFlag } from './qc/types';
import type { TranslationProvider } from './types';

const params = { enableDebugging: false } as ctxParamsType;

/** DeepL-shaped mock: native batch API echoing segments through `translate`. */
const providerWith = (
  translate: (segment: string) => string,
): TranslationProvider & { translateArray: ReturnType<typeof vi.fn> } =>
  ({
    vendor: 'deepl',
    streamText: vi.fn(),
    completeText: vi.fn(),
    translateArray: vi
      .fn()
      .mockImplementation(async (segments: string[]) => segments.map(translate)),
  }) as never;

describe('translateJsonFieldValue', () => {
  it('translates only string values — keys, numbers, booleans, null survive', async () => {
    const provider = providerWith((s) => `PT:${s}`);
    const source = JSON.stringify({
      tags: ['travel', 'guide'],
      meta: { readingLevel: 'intermediate', estimatedMinutes: 8, draft: false, extra: null },
    });

    const out = (await translateJsonFieldValue(
      source,
      params,
      'pt-BR',
      'en',
      provider,
      undefined,
      '',
      {},
    )) as string;

    const parsed = JSON.parse(out);
    expect(parsed).toEqual({
      tags: ['PT:travel', 'PT:guide'],
      meta: {
        readingLevel: 'PT:intermediate',
        estimatedMinutes: 8,
        draft: false,
        extra: null,
      },
    });
  });

  it('sends only non-empty string leaves to the provider', async () => {
    const provider = providerWith((s) => `X:${s}`);
    const source = JSON.stringify({ a: '', b: 'text', c: 7, d: ['', 'more'] });

    const out = (await translateJsonFieldValue(
      source,
      params,
      'de',
      'en',
      provider,
      undefined,
      '',
      {},
    )) as string;

    expect(provider.translateArray).toHaveBeenCalledTimes(1);
    expect(provider.translateArray.mock.calls[0][0]).toEqual(['text', 'more']);
    expect(JSON.parse(out)).toEqual({ a: '', b: 'X:text', c: 7, d: ['', 'X:more'] });
  });

  it('returns the value untouched (no provider call) when it holds no translatable strings', async () => {
    const provider = providerWith((s) => s);
    const source = JSON.stringify({ count: 3, flags: [true, false] });

    const out = await translateJsonFieldValue(
      source,
      params,
      'fr',
      'en',
      provider,
      undefined,
      '',
      {},
    );

    expect(out).toBe(source);
    expect(provider.translateArray).not.toHaveBeenCalled();
  });

  it('preserves placeholder tokens inside string values', async () => {
    // translateArray's tokenize/detokenize runs under this path too; a
    // token-preserving provider response must round-trip the placeholder.
    const provider = providerWith((s) => s);
    const source = JSON.stringify({ promo: 'Only {{nights}} nights at %s' });

    const out = (await translateJsonFieldValue(
      source,
      params,
      'ru',
      'en',
      provider,
      undefined,
      '',
      {},
    )) as string;

    expect(JSON.parse(out).promo).toContain('{{nights}}');
    expect(JSON.parse(out).promo).toContain('%s');
  });

  it('falls back to plain-text translation with a warning flag when the source is not valid JSON', async () => {
    const provider = providerWith((s) => `T:${s}`);
    const flags: QcFlag[] = [];

    const out = await translateJsonFieldValue(
      'not json at all {',
      params,
      'es',
      'en',
      provider,
      undefined,
      '',
      { onQcFlag: (flag) => flags.push(flag) },
    );

    expect(out).toBe('T:not json at all {');
    expect(flags.some((f) => f.checkId === 'json-validity' && f.severity === 'warning')).toBe(
      true,
    );
  });

  it('passes empty values through untouched', async () => {
    const provider = providerWith((s) => s);
    expect(
      await translateJsonFieldValue('', params, 'es', 'en', provider, undefined, '', {}),
    ).toBe('');
    expect(
      await translateJsonFieldValue(null, params, 'es', 'en', provider, undefined, '', {}),
    ).toBeNull();
  });
});
