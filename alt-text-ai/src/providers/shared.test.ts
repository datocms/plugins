import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ALT_TEXT_PROMPT,
  expandPromptTemplate,
  fetchImageAsBase64,
  MAX_INLINE_IMAGE_BYTES,
  sanitizeAltText,
} from './shared';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('provider shared helpers', () => {
  it('expands filenames literally and locales unambiguously', () => {
    const result = expandPromptTemplate('{filename} — {locale} — {filename}', {
      filename: '$&-hero.jpg',
      locale: 'pt-BR',
    });

    expect(result).toContain('$&-hero.jpg');
    expect(result).toContain('Portuguese');
    expect(result).toContain('locale code "pt-BR"');
  });

  it('does not let the Italian locale code read as the English pronoun', () => {
    expect(
      expandPromptTemplate('Write this in {locale}.', {
        filename: 'hero.jpg',
        locale: 'it',
      }),
    ).toBe('Write this in Italian (locale code "it").');
  });

  it('uses an accessible default prompt for an empty template', () => {
    const result = expandPromptTemplate('   ', {
      filename: 'hero.jpg',
      locale: 'en',
    });

    expect(result).not.toBe(DEFAULT_ALT_TEXT_PROMPT);
    expect(result).toContain('hero.jpg');
    expect(result).toContain('English');
    expect(result).toContain('locale code "en"');
  });

  it('removes common model wrappers and normalizes whitespace', () => {
    expect(
      sanitizeAltText('```text\nAlt text: “A red kite\n in the sky”\n```'),
    ).toBe('A red kite in the sky');
  });

  it('removes a label wrapped inside quotation marks', () => {
    expect(sanitizeAltText('"Alt text: A red kite"')).toBe('A red kite');
  });
});

describe('bounded image downloads', () => {
  it('rejects oversized declared image lengths before reading the body', async () => {
    const cancel = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(new ReadableStream<Uint8Array>({ cancel }), {
          headers: {
            'Content-Type': 'image/jpeg',
            'Content-Length': String(MAX_INLINE_IMAGE_BYTES + 1),
          },
        }),
      ),
    );
    await expect(
      fetchImageAsBase64('gemini', 'https://images.example/large.jpg'),
    ).rejects.toMatchObject({ code: 'image_fetch' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([
    'text/html',
    'image/svg+xml',
    'image/gif',
    null,
  ])('rejects unsupported MIME %s without paying for generation', async (mimeType) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: mimeType ? { 'Content-Type': mimeType } : {},
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      fetchImageAsBase64('gemini', 'https://images.example/invalid'),
    ).rejects.toMatchObject({ code: 'image_fetch' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects empty images', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(null, { headers: { 'Content-Type': 'image/jpeg' } }),
        ),
    );
    await expect(
      fetchImageAsBase64('gemini', 'https://images.example/empty.jpg'),
    ).rejects.toMatchObject({ code: 'image_fetch' });
  });

  it('encodes multiple image chunks without introducing intermediate base64 padding', async () => {
    const bytes = Uint8Array.from(
      { length: 0x6000 + 7 },
      (_, index) => index % 256,
    );
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(bytes, {
          headers: { 'Content-Type': 'image/png; charset=binary' },
        }),
      ),
    );
    const image = await fetchImageAsBase64(
      'gemini',
      'https://images.example/chunks.png',
    );
    expect(image.mimeType).toBe('image/png');
    expect(image.data).toBe(btoa(String.fromCharCode(...bytes)));
  });
});
