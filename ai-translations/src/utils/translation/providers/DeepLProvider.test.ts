/**
 * Tests for DeepLProvider.ts
 * Tests DeepL API provider implementation with batch translation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import DeepLProvider from './DeepLProvider';
import { ProviderError } from '../types';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('DeepLProvider', () => {
  let provider: DeepLProvider;

  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch.mockReset();

    provider = new DeepLProvider({
      apiKey: 'test-api-key',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should use default base URL', () => {
      const p = new DeepLProvider({ apiKey: 'key' });
      expect(p.vendor).toBe('deepl');
    });

    it('should accept custom base URL', () => {
      const p = new DeepLProvider({
        apiKey: 'key',
        baseUrl: 'https://api-free.deepl.com',
      });
      expect(p.vendor).toBe('deepl');
    });
  });

  describe('vendor property', () => {
    it('should have vendor set to "deepl"', () => {
      expect(provider.vendor).toBe('deepl');
    });
  });

  describe('translateArray', () => {
    it('should return empty array for empty input', async () => {
      const result = await provider.translateArray([], { targetLang: 'DE' });
      expect(result).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should call DeepL API via CORS proxy', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            translations: [{ text: 'Hallo' }, { text: 'Welt' }],
          }),
      });

      await provider.translateArray(['Hello', 'World'], { targetLang: 'DE' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('cors-proxy.datocms.com'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'content-type': 'application/json',
            Authorization: 'DeepL-Auth-Key test-api-key',
          }),
        })
      );
    });

    it('should include target language in request body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            translations: [{ text: 'Hallo' }],
          }),
      });

      await provider.translateArray(['Hello'], { targetLang: 'DE' });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.target_lang).toBe('DE');
    });

    it('should include source language when provided', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            translations: [{ text: 'Hallo' }],
          }),
      });

      await provider.translateArray(['Hello'], {
        targetLang: 'DE',
        sourceLang: 'EN',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.source_lang).toBe('EN');
    });

    it('should set tag_handling for HTML mode', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            translations: [{ text: '<p>Hallo</p>' }],
          }),
      });

      await provider.translateArray(['<p>Hello</p>'], {
        targetLang: 'DE',
        isHTML: true,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tag_handling).toBe('html');
    });

    it('should include formality when provided', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            translations: [{ text: 'Hallo' }],
          }),
      });

      await provider.translateArray(['Hello'], {
        targetLang: 'DE',
        formality: 'more',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.formality).toBe('more');
    });

    it('should not include formality when set to default', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            translations: [{ text: 'Hallo' }],
          }),
      });

      await provider.translateArray(['Hello'], {
        targetLang: 'DE',
        formality: 'default',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.formality).toBeUndefined();
    });

    it('should include preserve_formatting as boolean', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            translations: [{ text: 'Hallo' }],
          }),
      });

      await provider.translateArray(['Hello'], {
        targetLang: 'DE',
        preserveFormatting: true,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.preserve_formatting).toBe(true);
    });

    it('should include tag arrays when provided', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            translations: [{ text: 'Hallo' }],
          }),
      });

      await provider.translateArray(['Hello'], {
        targetLang: 'DE',
        ignoreTags: ['code', 'pre'],
        nonSplittingTags: ['a', 'strong'],
        splittingTags: ['br'],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.ignore_tags).toEqual(['code', 'pre']);
      expect(body.non_splitting_tags).toEqual(['a', 'strong']);
      expect(body.splitting_tags).toEqual(['br']);
    });

    it('should include glossary_id when provided', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            translations: [{ text: 'Hallo' }],
          }),
      });

      await provider.translateArray(['Hello'], {
        targetLang: 'DE',
        glossaryId: 'gls-123',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.glossary_id).toBe('gls-123');
    });

    it('should return translated texts in order', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            translations: [
              { text: 'Hallo' },
              { text: 'Welt' },
              { text: 'Wie geht es' },
            ],
          }),
      });

      const result = await provider.translateArray(
        ['Hello', 'World', 'How are you'],
        { targetLang: 'DE' }
      );

      expect(result).toEqual(['Hallo', 'Welt', 'Wie geht es']);
    });

    it('should handle batch splitting for large arrays', async () => {
      const largeArray = Array(100).fill('Hello');
      const mockResponse = {
        translations: Array(45).fill({ text: 'Hallo' }),
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await provider.translateArray(largeArray, { targetLang: 'DE' });

      // Should make 3 calls (45 + 45 + 10)
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    describe('error handling', () => {
      it('should throw ProviderError for non-OK response', async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          json: () => Promise.resolve({ message: 'Invalid key' }),
        });

        await expect(
          provider.translateArray(['Hello'], { targetLang: 'DE' })
        ).rejects.toThrow(ProviderError);
      });

      it('should detect wrong endpoint error and provide hint', async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          json: () => Promise.resolve({ message: 'Wrong endpoint' }),
        });

        try {
          await provider.translateArray(['Hello'], { targetLang: 'DE' });
          expect.fail('Should have thrown');
        } catch (e) {
          expect((e as Error).message).toContain('wrong endpoint');
        }
      });

      it('should provide helpful hint for Free key on Pro endpoint', async () => {
        const freeProvider = new DeepLProvider({
          apiKey: 'test-key:fx',
          baseUrl: 'https://api.deepl.com',
        });

        mockFetch.mockResolvedValue({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          json: () => Promise.resolve({ message: 'Wrong endpoint' }),
        });

        try {
          await freeProvider.translateArray(['Hello'], { targetLang: 'DE' });
          expect.fail('Should have thrown');
        } catch (e) {
          expect((e as Error).message).toContain('Free');
        }
      });

      it('should retry without glossary on glossary mismatch', async () => {
        let callCount = 0;
        mockFetch.mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve({
              ok: false,
              status: 400,
              statusText: 'Bad Request',
              json: () =>
                Promise.resolve({
                  message: 'Glossary language pair does not match',
                }),
            });
          }
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                translations: [{ text: 'Hallo' }],
              }),
          });
        });

        const result = await provider.translateArray(['Hello'], {
          targetLang: 'DE',
          glossaryId: 'gls-wrong',
        });

        expect(result).toEqual(['Hallo']);
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });

      it('should fallback to original text on missing translation', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              translations: [{ text: 'Hallo' }], // Only one translation for two inputs
            }),
        });

        const result = await provider.translateArray(['Hello', 'World'], {
          targetLang: 'DE',
        });

        // Second item should fallback to original
        expect(result[0]).toBe('Hallo');
        expect(result[1]).toBe('World');
      });

      it('should handle JSON parse errors in error response', async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: () => Promise.reject(new Error('Invalid JSON')),
        });

        await expect(
          provider.translateArray(['Hello'], { targetLang: 'DE' })
        ).rejects.toThrow();
      });
    });

    describe('response parsing', () => {
      it('should handle missing translations array', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({}),
        });

        const result = await provider.translateArray(['Hello'], {
          targetLang: 'DE',
        });

        // Should fallback to original
        expect(result).toEqual(['Hello']);
      });

      it('should convert null text to empty string', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              translations: [{ text: null }],
            }),
        });

        const result = await provider.translateArray(['Hello'], {
          targetLang: 'DE',
        });

        expect(result[0]).toBe('');
      });
    });
  });

  describe('completeText', () => {
    it('should translate single text to English', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            translations: [{ text: 'Hello' }],
          }),
      });

      const result = await provider.completeText('Hallo');

      expect(result).toBe('Hello');
    });

    it('should call API even for empty prompt and return result', async () => {
      // DeepL completeText always calls translateArray, even for empty prompts
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            translations: [{ text: '' }],
          }),
      });

      const result = await provider.completeText('');
      expect(result).toBe('');
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('streamText', () => {
    it('should yield single result', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            translations: [{ text: 'Hello' }],
          }),
      });

      const chunks: string[] = [];
      for await (const chunk of provider.streamText('Hallo')) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Hello']);
    });

    it('should yield original when API returns empty translations', async () => {
      // When translations array is empty, translateArray falls back to original
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            translations: [],
          }),
      });

      const chunks: string[] = [];
      for await (const chunk of provider.streamText('Hallo')) {
        chunks.push(chunk);
      }

      // Falls back to original text when no translation is returned
      expect(chunks).toEqual(['Hallo']);
    });
  });
});
