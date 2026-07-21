import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../types';
import YandexProvider from './YandexProvider';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const languagesBody = {
  languages: [
    { code: 'de', name: 'German' },
    { code: 'en', name: 'English' },
    { code: 'fr', name: 'French' },
    { code: 'pt', name: 'Portuguese' },
    { code: 'pt-BR', name: 'Portuguese (Brazil)' },
    { code: 'zh', name: 'Chinese' },
  ],
};

function jsonResponse(
  body: unknown,
  options: {
    ok?: boolean;
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
  } = {},
): Response {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    statusText: options.statusText ?? 'OK',
    headers: new Headers(options.headers),
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function invalidJsonResponse(): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers(),
    json: vi.fn().mockRejectedValue(new SyntaxError('Invalid JSON')),
  } as unknown as Response;
}

function translationResponse(...texts: string[]): Response {
  return jsonResponse({ translations: texts.map((text) => ({ text })) });
}

function requestBody(callIndex: number): Record<string, unknown> {
  return JSON.parse(mockFetch.mock.calls[callIndex][1].body);
}

describe('YandexProvider', () => {
  let provider: YandexProvider;

  beforeEach(() => {
    vi.useRealTimers();
    mockFetch.mockReset();
    provider = new YandexProvider({ apiKey: ' test-api-key ' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('identifies itself as the Yandex provider', () => {
    expect(provider.vendor).toBe('yandex');
  });

  describe('listLanguages and credential testing', () => {
    it('calls the REST v2 language endpoint through the DatoCMS proxy', async () => {
      mockFetch.mockResolvedValue(jsonResponse(languagesBody));

      const languages = await provider.listLanguages();

      expect(languages).toEqual(languagesBody.languages);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('cors-proxy.datocms.com'),
        expect.objectContaining({
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Authorization: 'Api-Key test-api-key',
          },
        }),
      );
      expect(mockFetch.mock.calls[0][0]).toContain(
        encodeURIComponent(
          'https://translate.api.cloud.yandex.net/translate/v2/languages',
        ),
      );
    });

    it('trims and includes an optional folder ID', async () => {
      provider = new YandexProvider({
        apiKey: 'key',
        folderId: ' folder-123 ',
      });
      mockFetch.mockResolvedValue(jsonResponse(languagesBody));

      await provider.listLanguages();

      expect(requestBody(0)).toEqual({ folderId: 'folder-123' });
    });

    it('omits a blank folder ID', async () => {
      provider = new YandexProvider({ apiKey: 'key', folderId: '   ' });
      mockFetch.mockResolvedValue(jsonResponse(languagesBody));

      await provider.listLanguages();

      expect(requestBody(0)).toEqual({});
    });

    it('caches a successful language list', async () => {
      mockFetch.mockResolvedValue(jsonResponse(languagesBody));

      await provider.listLanguages();
      await provider.listLanguages();

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('deduplicates concurrent language-list requests', async () => {
      mockFetch.mockResolvedValue(jsonResponse(languagesBody));

      await Promise.all([
        provider.listLanguages(),
        provider.listLanguages(),
        provider.listLanguages(),
      ]);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('performs a fresh request when explicitly testing credentials', async () => {
      mockFetch.mockResolvedValue(jsonResponse(languagesBody));
      await provider.listLanguages();

      await provider.testCredentials();

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('clears a rejected language cache so a corrected request can succeed', async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse(
            { code: 16, message: 'Unauthenticated' },
            { ok: false, status: 401, statusText: 'Unauthorized' },
          ),
        )
        .mockResolvedValueOnce(jsonResponse(languagesBody));

      await expect(provider.listLanguages()).rejects.toBeInstanceOf(
        ProviderError,
      );
      await expect(provider.listLanguages()).resolves.toEqual(
        languagesBody.languages,
      );
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('rejects malformed and empty language responses', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ languages: [] }));
      await expect(provider.listLanguages()).rejects.toMatchObject({
        status: 502,
        vendor: 'yandex',
      });

      mockFetch.mockResolvedValueOnce(
        jsonResponse({ languages: [{ code: 42, name: 'Invalid' }] }),
      );
      await expect(provider.listLanguages()).rejects.toThrow(
        'invalid language-list response',
      );
    });
  });

  describe('translateArray', () => {
    it('returns immediately for empty input', async () => {
      await expect(
        provider.translateArray([], { targetLang: 'de' }),
      ).resolves.toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('sends native text batches with resolved source and target locales', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(languagesBody))
        .mockResolvedValueOnce(translationResponse('Hallo', 'Welt'));

      const result = await provider.translateArray(['Hello', 'World'], {
        sourceLang: 'EN_us',
        targetLang: 'de-DE',
      });

      expect(result).toEqual(['Hallo', 'Welt']);
      expect(requestBody(1)).toEqual({
        texts: ['Hello', 'World'],
        sourceLanguageCode: 'en',
        targetLanguageCode: 'de',
        format: 'PLAIN_TEXT',
      });
      expect(mockFetch.mock.calls[1][0]).toContain(
        encodeURIComponent(
          'https://translate.api.cloud.yandex.net/translate/v2/translate',
        ),
      );
    });

    it('uses HTML format and includes the configured folder ID', async () => {
      provider = new YandexProvider({ apiKey: 'key', folderId: 'folder' });
      mockFetch
        .mockResolvedValueOnce(jsonResponse(languagesBody))
        .mockResolvedValueOnce(translationResponse('<p>Bonjour</p>'));

      await provider.translateArray(['<p>Hello</p>'], {
        targetLang: 'fr',
        isHTML: true,
      });

      expect(requestBody(1)).toEqual({
        texts: ['<p>Hello</p>'],
        targetLanguageCode: 'fr',
        format: 'HTML',
        folderId: 'folder',
      });
    });

    it('preserves an exact nonstandard regional Yandex target code', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(languagesBody))
        .mockResolvedValueOnce(translationResponse('Olá'));

      await provider.translateArray(['Hello'], { targetLang: 'pt_br' });

      expect(requestBody(1).targetLanguageCode).toBe('pt-BR');
    });

    it('omits an unsupported source locale to enable auto-detection', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(languagesBody))
        .mockResolvedValueOnce(translationResponse('Hello'));

      await provider.translateArray(['Saluton'], {
        sourceLang: 'eo',
        targetLang: 'en',
      });

      expect(requestBody(1).sourceLanguageCode).toBeUndefined();
    });

    it('rejects an unsupported target before making a translation request', async () => {
      mockFetch.mockResolvedValue(jsonResponse(languagesBody));

      await expect(
        provider.translateArray(['Hello'], {
          targetLang: 'xx-YY',
          originalTargetLocale: 'xx_YY',
        }),
      ).rejects.toThrow('target locale "xx_YY"');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('accepts a segment containing exactly 10,000 Unicode code points', async () => {
      const segment = '😀'.repeat(10_000);
      mockFetch
        .mockResolvedValueOnce(jsonResponse(languagesBody))
        .mockResolvedValueOnce(translationResponse('translated'));

      await expect(
        provider.translateArray([segment], { targetLang: 'en' }),
      ).resolves.toEqual(['translated']);
      expect((requestBody(1).texts as string[])[0]).toBe(segment);
    });

    it('rejects an oversized segment before making any request', async () => {
      const segment = '😀'.repeat(10_001);

      await expect(
        provider.translateArray([segment], { targetLang: 'en' }),
      ).rejects.toMatchObject({ status: 400, vendor: 'yandex' });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('greedily batches by Unicode code points without splitting segments', async () => {
      const first = '😀'.repeat(6_000);
      const second = '💡'.repeat(4_000);
      const third = 'x';
      mockFetch
        .mockResolvedValueOnce(jsonResponse(languagesBody))
        .mockResolvedValueOnce(translationResponse('one', 'two'))
        .mockResolvedValueOnce(translationResponse('three'));

      const result = await provider.translateArray([first, second, third], {
        targetLang: 'en',
      });

      expect(result).toEqual(['one', 'two', 'three']);
      expect(requestBody(1).texts).toEqual([first, second]);
      expect(requestBody(2).texts).toEqual([third]);
    });

    it('rejects response-count mismatches instead of falling back to source text', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(languagesBody))
        .mockResolvedValueOnce(translationResponse('only one'));

      await expect(
        provider.translateArray(['one', 'two'], { targetLang: 'de' }),
      ).rejects.toMatchObject({ status: 502, vendor: 'yandex' });
    });

    it('rejects malformed translation entries', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(languagesBody))
        .mockResolvedValueOnce(
          jsonResponse({ translations: [{ text: 123 }] }),
        );

      await expect(
        provider.translateArray(['one'], { targetLang: 'de' }),
      ).rejects.toThrow('invalid translation response');
    });
  });

  describe('request lifecycle', () => {
    it('spaces concurrent translation request starts below 20 calls per second', async () => {
      mockFetch.mockResolvedValue(jsonResponse(languagesBody));
      await provider.listLanguages();
      mockFetch.mockReset();
      vi.useFakeTimers();
      vi.setSystemTime(1_000);
      const requestTimes: number[] = [];
      mockFetch.mockImplementation((_url, init) => {
        requestTimes.push(Date.now());
        const body = JSON.parse(init.body);
        return Promise.resolve(
          translationResponse(...body.texts.map((text: string) => `t:${text}`)),
        );
      });

      const requests = [
        provider.translateArray(['one'], { targetLang: 'de' }),
        provider.translateArray(['two'], { targetLang: 'de' }),
        provider.translateArray(['three'], { targetLang: 'de' }),
      ];
      await vi.advanceTimersByTimeAsync(0);
      expect(requestTimes).toEqual([1_000]);
      await vi.advanceTimersByTimeAsync(54);
      expect(requestTimes).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(requestTimes).toEqual([1_000, 1_055]);
      await vi.advanceTimersByTimeAsync(55);

      await expect(Promise.all(requests)).resolves.toEqual([
        ['t:one'],
        ['t:two'],
        ['t:three'],
      ]);
      expect(requestTimes).toEqual([1_000, 1_055, 1_110]);
    });

    it('converts timeout aborts to a Yandex ProviderError', async () => {
      vi.useFakeTimers();
      mockFetch.mockImplementation((_url, init) => {
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            reject(init.signal.reason);
          });
        });
      });

      const promise = provider.listLanguages({ timeoutMs: 25 });
      const assertion = expect(promise).rejects.toMatchObject({
        status: 408,
        vendor: 'yandex',
      });
      await vi.advanceTimersByTimeAsync(25);
      await assertion;
    });

    it('preserves caller cancellation', async () => {
      const controller = new AbortController();
      mockFetch.mockImplementation((_url, init) => {
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            reject(init.signal.reason);
          });
        });
      });

      const promise = provider.listLanguages({
        abortSignal: controller.signal,
      });
      controller.abort(new DOMException('Cancelled', 'AbortError'));

      await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('wraps network failures with provider context', async () => {
      mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(provider.listLanguages()).rejects.toMatchObject({
        message: 'Yandex Translate network request failed: Failed to fetch',
        vendor: 'yandex',
      });
    });

    it('emits request and response debug hooks without exposing credentials', async () => {
      const request = vi.fn();
      const response = vi.fn();
      mockFetch.mockResolvedValue(jsonResponse(languagesBody));

      await provider.listLanguages({ debug: { request, response } });

      expect(request).toHaveBeenCalledWith(
        'Provider request',
        expect.objectContaining({ provider: 'yandex', operation: 'listLanguages' }),
      );
      expect(response).toHaveBeenCalledWith(
        'Provider response',
        expect.objectContaining({ provider: 'yandex', operation: 'listLanguages' }),
      );
      expect(JSON.stringify(request.mock.calls)).not.toContain('test-api-key');
    });
  });

  describe('error responses', () => {
    it('maps a gRPC error embedded in an HTTP 200 response', async () => {
      mockFetch.mockResolvedValue(
        jsonResponse({
          code: 8,
          message: 'Quota exceeded',
          details: [{ requestId: 'request-123' }],
        }),
      );

      await expect(provider.listLanguages()).rejects.toMatchObject({
        message: 'Quota exceeded (request ID: request-123)',
        status: 429,
        vendor: 'yandex',
      });
    });

    it('maps named gRPC codes embedded in HTTP 200 responses', async () => {
      mockFetch.mockResolvedValue(
        jsonResponse({
          error: {
            status: 'PERMISSION_DENIED',
            message: 'Folder access denied',
          },
        }),
      );

      await expect(provider.listLanguages()).rejects.toMatchObject({
        status: 403,
        vendor: 'yandex',
      });
    });

    it('preserves an upstream HTTP status and reads the request ID header', async () => {
      mockFetch.mockResolvedValue(
        jsonResponse(
          { message: 'Invalid API key' },
          {
            ok: false,
            status: 401,
            statusText: 'Unauthorized',
            headers: { 'x-request-id': 'header-request-id' },
          },
        ),
      );

      await expect(provider.listLanguages()).rejects.toMatchObject({
        message: 'Invalid API key (request ID: header-request-id)',
        status: 401,
      });
    });

    it('rejects non-JSON success responses', async () => {
      mockFetch.mockResolvedValue(invalidJsonResponse());

      await expect(provider.listLanguages()).rejects.toMatchObject({
        status: 502,
        vendor: 'yandex',
      });
    });
  });

  describe('completion wrappers', () => {
    it('translates completeText to English', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(languagesBody))
        .mockResolvedValueOnce(translationResponse('Hello'));

      await expect(provider.completeText('Bonjour')).resolves.toBe('Hello');
      expect(requestBody(1).targetLanguageCode).toBe('en');
    });

    it('yields one complete translation from streamText', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(languagesBody))
        .mockResolvedValueOnce(translationResponse('Hello'));

      const chunks: string[] = [];
      for await (const chunk of provider.streamText('Bonjour')) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Hello']);
    });
  });
});
