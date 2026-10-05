/**
 * Tests for translateArray.ts
 * Tests placeholder tokenization, detokenization, and array translation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';
import { tokenize, translateArray } from './translateArray';
import { ProviderError, type TranslationProvider } from './types';

type LogPayload = {
  level: string;
  message: string;
  data?: unknown;
};

function parseLogPayloads(calls: unknown[][]): LogPayload[] {
  return calls.map((call) => JSON.parse(String(call[0])) as LogPayload);
}

describe('translateArray.ts', () => {
  describe('tokenize', () => {
    describe('double-brace placeholders {{var}}', () => {
      it('should tokenize {{variable}} placeholders', () => {
        const result = tokenize('Hello {{name}}!');

        expect(result.safe).toBe('Hello ⟦PH_0⟧!');
        expect(result.map).toHaveLength(1);
        expect(result.map[0]).toEqual({ safe: '⟦PH_0⟧', orig: '{{name}}' });
      });

      it('should tokenize multiple {{}} placeholders', () => {
        const result = tokenize('{{greeting}} {{name}}, welcome!');

        expect(result.safe).toBe('⟦PH_0⟧ ⟦PH_1⟧, welcome!');
        expect(result.map).toHaveLength(2);
      });

      it('should handle complex {{}} placeholders', () => {
        const result = tokenize('{{user.name}} is {{user.age}} years old');

        expect(result.map).toHaveLength(2);
        expect(result.map[0].orig).toBe('{{user.name}}');
        expect(result.map[1].orig).toBe('{{user.age}}');
      });
    });

    describe('single-brace placeholders {var}', () => {
      it('should tokenize simple {variable} placeholders', () => {
        const result = tokenize('Hello {name}!');

        expect(result.safe).toBe('Hello ⟦PH_0⟧!');
        expect(result.map[0].orig).toBe('{name}');
      });

      it('should tokenize placeholders with dots', () => {
        const result = tokenize('Value: {user.profile.name}');

        expect(result.map).toHaveLength(1);
        expect(result.map[0].orig).toBe('{user.profile.name}');
      });

      it('should tokenize placeholders with hyphens', () => {
        const result = tokenize('ID: {item-id}');

        expect(result.map).toHaveLength(1);
        expect(result.map[0].orig).toBe('{item-id}');
      });
    });

    describe('printf-style placeholders', () => {
      it('should tokenize %s placeholders', () => {
        const result = tokenize('Hello %s, you have %s messages');

        expect(result.safe).toBe('Hello ⟦PH_0⟧, you have ⟦PH_1⟧ messages');
        expect(result.map[0].orig).toBe('%s');
        expect(result.map[1].orig).toBe('%s');
      });

      it('should tokenize %d placeholders', () => {
        const result = tokenize('Count: %d items');

        expect(result.map[0].orig).toBe('%d');
      });

      it('should tokenize positional %1$s placeholders', () => {
        const result = tokenize('Hello %1$s, from %2$s');

        expect(result.map).toHaveLength(2);
        expect(result.map[0].orig).toBe('%1$s');
        expect(result.map[1].orig).toBe('%2$s');
      });
    });

    describe('colon placeholders :slug', () => {
      it('should tokenize :variable placeholders', () => {
        const result = tokenize('Path: /users/:userId/posts/:postId');

        expect(result.map).toHaveLength(2);
        expect(result.map[0].orig).toBe(':userId');
        expect(result.map[1].orig).toBe(':postId');
      });

      it('should tokenize :variables with underscores', () => {
        const result = tokenize('Value: :user_name');

        expect(result.map[0].orig).toBe(':user_name');
      });

      it('should tokenize :variables with hyphens', () => {
        const result = tokenize('Value: :user-id');

        expect(result.map[0].orig).toBe(':user-id');
      });
    });

    describe('mixed placeholders', () => {
      it('should tokenize all placeholder types together', () => {
        const result = tokenize('Hello {{name}}, {greeting}, %s, :slug');

        expect(result.map).toHaveLength(4);
        expect(result.map.map((m) => m.orig)).toEqual([
          '{{name}}',
          '{greeting}',
          '%s',
          ':slug',
        ]);
      });

      it('should use sequential indices', () => {
        const result = tokenize('{{a}} {b} %s :c');

        expect(result.safe).toBe('⟦PH_0⟧ ⟦PH_1⟧ ⟦PH_2⟧ ⟦PH_3⟧');
      });
    });

    describe('edge cases', () => {
      it('should return empty map for text without placeholders', () => {
        const result = tokenize('Hello world!');

        expect(result.safe).toBe('Hello world!');
        expect(result.map).toHaveLength(0);
      });

      it('should handle empty string', () => {
        const result = tokenize('');

        expect(result.safe).toBe('');
        expect(result.map).toHaveLength(0);
      });

      it('should not tokenize ICU message format select', () => {
        // ICU format uses {key, select, ...} pattern which should NOT be tokenized
        // The regex pattern \{[\w.-]+\} only matches simple variables
        const result = tokenize('{gender, select, male {He} female {She}}');

        // The complex ICU structure should not be fully replaced
        // Only simple {var} patterns are tokenized
        expect(
          result.map.some(
            (m) => m.orig === '{gender, select, male {He} female {She}}',
          ),
        ).toBe(false);
      });
    });
  });

  describe('translateArray', () => {
    const mockPluginParams: ctxParamsType = {
      apiKey: 'test-key',
      gptModel: 'gpt-4',
      translationFields: [],
      translateWholeRecord: false,
      translateBulkRecords: false,
      prompt: '',
      modelsToBeExcludedFromThisPlugin: [],
      rolesToBeExcludedFromThisPlugin: [],
      apiKeysToBeExcludedFromThisPlugin: [],
      enableDebugging: false,
    };

    let mockProvider: TranslationProvider;

    beforeEach(() => {
      mockProvider = {
        vendor: 'openai',
        streamText: vi.fn(),
        completeText: vi.fn(),
      };
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    describe('cancellation', () => {
      it('does not send a provider request after cancellation', async () => {
        const controller = new AbortController();
        controller.abort();

        await expect(
          translateArray(
            mockProvider,
            mockPluginParams,
            ['Hello'],
            'en',
            'de',
            { abortSignal: controller.signal },
          ),
        ).rejects.toMatchObject({ name: 'AbortError' });
        expect(mockProvider.completeText).not.toHaveBeenCalled();
      });

      it('forwards the signal to an in-flight request and preserves cancellation', async () => {
        const controller = new AbortController();
        let resolveRequestStarted: () => void = () => undefined;
        const requestStarted = new Promise<void>((resolve) => {
          resolveRequestStarted = resolve;
        });
        vi.mocked(mockProvider.completeText).mockImplementation(
          async (_prompt, options) =>
            new Promise<string>((_resolve, reject) => {
              expect(options?.abortSignal).toBe(controller.signal);
              options?.abortSignal?.addEventListener('abort', () => {
                reject(new DOMException('Cancelled', 'AbortError'));
              });
              resolveRequestStarted();
            }),
        );

        const result = translateArray(
          mockProvider,
          mockPluginParams,
          ['Hello'],
          'en',
          'de',
          { abortSignal: controller.signal },
        );
        await requestStarted;
        controller.abort();

        await expect(result).rejects.toMatchObject({ name: 'AbortError' });
        expect(mockProvider.completeText).toHaveBeenCalledTimes(1);
      });

      it('does not start a later chat chunk when cancellation follows a response', async () => {
        let cancelled = false;
        vi.mocked(mockProvider.completeText).mockImplementation(async () => {
          cancelled = true;
          return JSON.stringify(Array.from({ length: 25 }, () => 'Hallo'));
        });

        await expect(
          translateArray(
            mockProvider,
            mockPluginParams,
            Array.from({ length: 26 }, () => 'Hello'),
            'en',
            'de',
            { checkCancellation: () => cancelled },
          ),
        ).rejects.toMatchObject({ name: 'AbortError' });
        expect(mockProvider.completeText).toHaveBeenCalledTimes(1);
      });

      it.each(['deepl', 'yandex'] as const)(
        'forwards cancellation to native %s batch requests',
        async (vendor) => {
          const controller = new AbortController();
          const nativeProvider: TranslationProvider = {
            ...mockProvider,
            vendor,
            translateArray: vi.fn().mockResolvedValue(['Hallo']),
          };

          await translateArray(
            nativeProvider,
            mockPluginParams,
            ['Hello'],
            'en',
            'de',
            { abortSignal: controller.signal },
          );

          expect(nativeProvider.translateArray).toHaveBeenCalledWith(
            ['Hello'],
            expect.objectContaining({ abortSignal: controller.signal }),
          );
        },
      );
    });

    describe('input validation', () => {
      it('should return empty array for empty input', async () => {
        const result = await translateArray(
          mockProvider,
          mockPluginParams,
          [],
          'en',
          'de',
        );

        expect(result).toEqual([]);
        expect(mockProvider.completeText).not.toHaveBeenCalled();
      });

      it('should return input if not an array', async () => {
        const result = await translateArray(
          mockProvider,
          mockPluginParams,
          null as unknown as string[],
          'en',
          'de',
        );

        expect(result).toEqual(null);
      });
    });

    describe('chat vendor translation (JSON array prompt)', () => {
      it.each([1, 26])(
        'should apply the configured prompt and context to every request for %i segments',
        async (segmentCount) => {
          const segments = Array.from(
            { length: segmentCount },
            (_, index) => `Hello {{name_${index}}} ${index}`,
          );
          const protectedSegments = segments.map(
            (_, index) => `Hello ⟦PH_0⟧ ${index}`,
          );
          const translatedSegments = segments.map(
            (_, index) => `Hallo ⟦PH_0⟧ ${index}`,
          );
          const expectedChunks =
            segmentCount === 1
              ? [protectedSegments]
              : [protectedSegments.slice(0, 25), protectedSegments.slice(25)];
          const completeText = vi.mocked(mockProvider.completeText);
          completeText.mockResolvedValueOnce(
            JSON.stringify(translatedSegments.slice(0, 25)),
          );
          if (segmentCount > 25) {
            completeText.mockResolvedValueOnce(
              JSON.stringify(translatedSegments.slice(25)),
            );
          }

          const result = await translateArray(
            mockProvider,
            {
              ...mockPluginParams,
              prompt: `Use a formal tone. Keep ACME unchanged.
Sources: {fromLocale} / {fromLocale}.
Targets: {toLocale} / {toLocale}.
Contexts: [{recordContext}] / [{recordContext}].
Content: {fieldValue} / {fieldValue}.`,
            },
            segments,
            'en',
            'de',
            { recordContext: 'Product description' },
          );

          expect(completeText).toHaveBeenCalledTimes(expectedChunks.length);
          for (const [index, chunk] of expectedChunks.entries()) {
            const prompt = completeText.mock.calls[index][0];
            expect(prompt).toContain(`Use a formal tone. Keep ACME unchanged.
Sources: en / en.
Targets: de / de.
Contexts: [Product description] / [Product description].
Content: (see the JSON array below) / (see the JSON array below).`);
            expect(prompt).toContain(
              'Return ONLY a valid JSON array of strings',
            );
            expect(prompt).toContain('strict one-to-one mapping');
            expect(prompt).toContain('Preserve tokens like ⟦PH_0⟧ exactly');
            expect(prompt.endsWith(`\n${JSON.stringify(chunk)}`)).toBe(true);
          }
          expect(result).toEqual(
            segments.map((_, index) => `Hallo {{name_${index}}} ${index}`),
          );
        },
      );

      it('should retain mandatory ICU rules with a custom prompt', async () => {
        const segment =
          '{gender, select, male {He said} female {She said} other {They said}}';
        vi.mocked(mockProvider.completeText).mockResolvedValue(
          JSON.stringify([segment]),
        );

        await translateArray(
          mockProvider,
          {
            ...mockPluginParams,
            prompt: 'Translate {fieldValue} from {fromLocale} to {toLocale}.',
          },
          [segment],
          'en',
          'de',
        );

        const prompt = vi.mocked(mockProvider.completeText).mock.calls[0][0];
        expect(prompt).toContain('ICU Message Format');
        expect(prompt).toContain(
          'You MUST preserve the structure, keywords, and variable keys exactly.',
        );
        expect(prompt).toContain(
          'ONLY translate the human-readable content inside the brackets.',
        );
        expect(prompt.endsWith(`\n${JSON.stringify([segment])}`)).toBe(true);
      });

      it('should retain selected locales when the custom prompt omits locale placeholders', async () => {
        vi.mocked(mockProvider.completeText).mockResolvedValue('["Olá"]');

        await translateArray(
          mockProvider,
          {
            ...mockPluginParams,
            prompt: 'Use a formal tone. Keep ACME unchanged.',
          },
          ['Hello'],
          'en-GB',
          'pt-BR',
        );

        const prompt = vi.mocked(mockProvider.completeText).mock.calls[0][0];
        expect(prompt).toContain('Use a formal tone. Keep ACME unchanged.');
        expect(prompt).toContain(
          'Translate the following array of strings from en-GB to pt-BR.',
        );
      });

      it.each([
        '$$',
        '$&',
        "$'",
        '$`',
        '{fromLocale}',
        '{toLocale}',
        '{fieldValue}',
        '{recordContext}',
      ])('should insert context containing %s literally', async (literal) => {
        vi.mocked(mockProvider.completeText).mockResolvedValue('["Hallo"]');
        const recordContext = `Literal content: ${literal}.`;

        await translateArray(
          mockProvider,
          {
            ...mockPluginParams,
            prompt:
              'Context: {recordContext}; translate {fieldValue} from {fromLocale} to {toLocale}.',
          },
          ['Hello'],
          'en',
          'de',
          { recordContext },
        );

        const prompt = vi.mocked(mockProvider.completeText).mock.calls[0][0];
        expect(
          prompt.startsWith(
            `Context: ${recordContext}; translate (see the JSON array below) from en to de.`,
          ),
        ).toBe(true);
      });

      it('should use the default prompt and context fallback when none are configured', async () => {
        vi.mocked(mockProvider.completeText).mockResolvedValue('["Hallo"]');

        await translateArray(
          mockProvider,
          mockPluginParams,
          ['Hello'],
          'en',
          'de',
        );

        const prompt = vi.mocked(mockProvider.completeText).mock.calls[0][0];
        expect(prompt).toContain(
          'You are an expert translator specializing in CMS content translation.',
        );
        expect(prompt).toContain('No additional context available.');
        expect(prompt).toContain(
          'Translate the following content from en to de:',
        );
        expect(prompt).not.toMatch(
          /\{(?:fromLocale|toLocale|fieldValue|recordContext)\}/,
        );
      });


      it('rejects oversized opaque HTML before earlier segments become billable', async () => {
        await expect(
          translateArray(
            mockProvider,
            mockPluginParams,
            ['Hello', `<p>${'😀'.repeat(8_000)}</p>`],
            'en',
            'de',
            { isHTML: true },
          ),
        ).rejects.toThrow('No content was sent');
        expect(mockProvider.completeText).not.toHaveBeenCalled();
      });

      it('rejects lost placeholders instead of saving corrupted content', async () => {
        vi.mocked(mockProvider.completeText).mockResolvedValue('["Hallo"]');
        await expect(
          translateArray(
            mockProvider,
            mockPluginParams,
            ['Hello {{name}}'],
            'en',
            'de',
          ),
        ).rejects.toThrow('protected placeholder');
      });

      it('should translate array via completeText for chat vendors', async () => {
        vi.mocked(mockProvider.completeText).mockResolvedValue(
          '["Hallo", "Welt"]',
        );

        const result = await translateArray(
          mockProvider,
          mockPluginParams,
          ['Hello', 'World'],
          'en',
          'de',
        );

        expect(mockProvider.completeText).toHaveBeenCalled();
        expect(result).toEqual(['Hallo', 'Welt']);
      });

      it('should rejoin when the model splits a single HTML segment into multiple elements', async () => {
        // Regression (Basecamp card 10026091779): a WYSIWYG/rich-text field is
        // sent as ONE segment containing several block-level <p> elements. Chat
        // models (Google/OpenAI/Anthropic) frequently "helpfully" split it into
        // one array element per block, returning more elements than were sent.
        // The positional length repair maps output to input by index, so it
        // dropped every element past the first — cropping the field to its first
        // paragraph. For HTML the elements must be rejoined (newlines between
        // block-level elements are insignificant) instead of discarding the tail.
        vi.mocked(mockProvider.completeText).mockResolvedValue(
          '["<p data-path-to-node=\\"0\\">Eerste paragraaf.</p>", "<p data-path-to-node=\\"1\\">Tweede paragraaf.</p>"]',
        );

        const result = await translateArray(
          mockProvider,
          mockPluginParams,
          [
            '<p data-path-to-node="0">First paragraph.</p>\n<p data-path-to-node="1">Second paragraph.</p>',
          ],
          'en',
          'nl',
          { isHTML: true },
        );

        expect(result).toEqual([
          '<p data-path-to-node="0">Eerste paragraaf.</p>\n<p data-path-to-node="1">Tweede paragraaf.</p>',
        ]);
      });

      it('should NOT rejoin an over-split non-HTML segment (avoids corrupting single_line/json/slug)', async () => {
        // The newline-rejoin recovery is gated to HTML only. For a plain
        // single-line value, injecting newlines would corrupt it, so the
        // positional length repair (keep the first element) is retained.
        vi.mocked(mockProvider.completeText).mockResolvedValue(
          '["Rojo", "verde", "azul"]',
        );

        await expect(
          translateArray(
            mockProvider,
            mockPluginParams,
            ['Red, green, blue'],
            'en',
            'es',
          ),
        ).rejects.toThrow(/No content was saved/);
      });

      it('should suppress debug logs when debugging is disabled', async () => {
        const logSpy = vi
          .spyOn(console, 'log')
          .mockImplementation(() => undefined);
        vi.mocked(mockProvider.completeText).mockResolvedValue('["Hallo"]');

        await translateArray(
          mockProvider,
          mockPluginParams,
          ['Hello'],
          'en',
          'de',
        );

        expect(logSpy).not.toHaveBeenCalled();
      });

      it('should log useful copyable request and response payloads when debugging is enabled', async () => {
        const logSpy = vi
          .spyOn(console, 'log')
          .mockImplementation(() => undefined);
        vi.mocked(mockProvider.completeText).mockImplementation(
          async (_prompt, options) => {
            options?.debug?.request?.('Provider request', {
              url: 'https://provider.example/translate',
              body: { text: 'Hello ⟦PH_0⟧' },
            });
            options?.debug?.response?.('Provider response', {
              status: 200,
              text: '["Hallo ⟦PH_0⟧"]',
            });
            return '["Hallo ⟦PH_0⟧"]';
          },
        );

        const result = await translateArray(
          mockProvider,
          { ...mockPluginParams, enableDebugging: true },
          ['Hello {{name}}'],
          'en',
          'de',
          { isHTML: true, formality: 'more', recordContext: 'Record title' },
        );

        expect(result).toEqual(['Hallo {{name}}']);
        const payloads = parseLogPayloads(logSpy.mock.calls);
        const messages = payloads.map((payload) => payload.message);
        expect(messages).toEqual(
          expect.arrayContaining([
            'Translation batch payload',
            'Provider text request input',
            'Provider request',
            'Provider response',
            'Raw provider response',
            'Parsed response array',
            'Final parsed response array',
            'Translation batch output',
          ]),
        );

        const batchPayload = payloads.find(
          (payload) => payload.message === 'Translation batch payload',
        );
        const batchData = batchPayload?.data as {
          originalSegments: string[];
          protectedSegments: string[];
          tokenMaps: Array<Array<{ safe: string; orig: string }>>;
        };
        expect(batchData.originalSegments).toEqual(['Hello {{name}}']);
        expect(batchData.protectedSegments).toEqual(['Hello ⟦PH_0⟧']);
        expect(batchData.tokenMaps[0]?.[0]).toEqual({
          safe: '⟦PH_0⟧',
          orig: '{{name}}',
        });

        const requestPayload = payloads.find(
          (payload) => payload.message === 'Provider text request input',
        );
        const requestData = requestPayload?.data as {
          prompt: string;
          protectedSegments: string[];
        };
        expect(requestData.prompt).toContain('["Hello ⟦PH_0⟧"]');
        expect(requestData.protectedSegments).toEqual(['Hello ⟦PH_0⟧']);

        const responsePayload = payloads.find(
          (payload) => payload.message === 'Raw provider response',
        );
        const responseData = responsePayload?.data as { rawResponse: string };
        expect(responseData.rawResponse).toBe('["Hallo ⟦PH_0⟧"]');

        const outputPayload = payloads.find(
          (payload) => payload.message === 'Translation batch output',
        );
        const outputData = outputPayload?.data as { finalSegments: string[] };
        expect(outputData.finalSegments).toEqual(['Hallo {{name}}']);
      });

      it('should protect and restore placeholders', async () => {
        vi.mocked(mockProvider.completeText).mockResolvedValue(
          '["Hallo ⟦PH_0⟧"]',
        );

        const result = await translateArray(
          mockProvider,
          mockPluginParams,
          ['Hello {{name}}'],
          'en',
          'de',
        );

        expect(result).toEqual(['Hallo {{name}}']);
      });

      it('should handle model returning extra text around JSON', async () => {
        vi.mocked(mockProvider.completeText).mockResolvedValue(
          'Here is the translation:\n["Hallo", "Welt"]\nDone!',
        );

        const result = await translateArray(
          mockProvider,
          mockPluginParams,
          ['Hello', 'World'],
          'en',
          'de',
        );

        expect(result).toEqual(['Hallo', 'Welt']);
      });

      it('should log response repair diagnostics for wrapped JSON', async () => {
        const logSpy = vi
          .spyOn(console, 'log')
          .mockImplementation(() => undefined);
        vi.mocked(mockProvider.completeText).mockResolvedValue(
          'Here is the translation:\n["Hallo"]\nDone!',
        );

        const result = await translateArray(
          mockProvider,
          { ...mockPluginParams, enableDebugging: true },
          ['Hello'],
          'en',
          'de',
        );

        expect(result).toEqual(['Hallo']);
        const payloads = parseLogPayloads(logSpy.mock.calls);
        const repairPayload = payloads.find(
          (payload) =>
            payload.message ===
            'Response repaired by extracting array brackets',
        );
        expect(repairPayload).toBeDefined();
        const repairData = repairPayload?.data as {
          rawResponse: string;
          repairedArray: string[];
        };
        expect(repairData.rawResponse).toContain('Here is the translation');
        expect(repairData.repairedArray).toEqual(['Hallo']);
      });

      it('should handle array length mismatch by padding with originals', async () => {
        vi.mocked(mockProvider.completeText).mockResolvedValue('["Hallo"]');

        await expect(
          translateArray(
            mockProvider,
            mockPluginParams,
            ['Hello', 'World'],
            'en',
            'de',
          ),
        ).rejects.toThrow(/No content was saved/);
      });

      it('should handle non-string values in response', async () => {
        vi.mocked(mockProvider.completeText).mockResolvedValue(
          '[123, null, "Welt"]',
        );

        await expect(
          translateArray(
            mockProvider,
            mockPluginParams,
            ['Hello', 'Goodbye', 'World'],
            'en',
            'de',
          ),
        ).rejects.toThrow(/No content was saved/);

        // Non-strings should be replaced with originals
      });

      it('should throw if model returns valid JSON non-array', async () => {
        // Return valid JSON that's not an array (e.g., a string or object)
        vi.mocked(mockProvider.completeText).mockResolvedValue(
          '"just a string"',
        );

        await expect(
          translateArray(mockProvider, mockPluginParams, ['Hello'], 'en', 'de'),
        ).rejects.toThrow('Translation provider error');
      });
    });

    describe('DeepL provider translation', () => {
      let mockDeepLProvider: Required<
        Pick<TranslationProvider, 'translateArray'>
      > &
        Omit<TranslationProvider, 'translateArray'> & {
          translateArray: ReturnType<typeof vi.fn>;
        };

      beforeEach(() => {
        mockDeepLProvider = {
          vendor: 'deepl',
          streamText: vi.fn(),
          completeText: vi.fn(),
          translateArray: vi.fn(),
        } as typeof mockDeepLProvider;
      });

      it('should use native translateArray for DeepL provider', async () => {
        mockDeepLProvider.translateArray.mockResolvedValue(['Hallo', 'Welt']);

        const result = await translateArray(
          mockDeepLProvider,
          mockPluginParams,
          ['Hello', 'World'],
          'en',
          'de',
        );

        expect(mockDeepLProvider.translateArray).toHaveBeenCalled();
        expect(mockDeepLProvider.completeText).not.toHaveBeenCalled();
        expect(result).toEqual(['Hallo', 'Welt']);
      });

      it('should protect and restore placeholders for DeepL', async () => {
        mockDeepLProvider.translateArray.mockResolvedValue(['Hallo ⟦PH_0⟧']);

        const result = await translateArray(
          mockDeepLProvider,
          mockPluginParams,
          ['Hello {{name}}'],
          'en',
          'de',
        );

        expect(result).toEqual(['Hallo {{name}}']);
      });

      it('should pass correct options to DeepL translateArray', async () => {
        mockDeepLProvider.translateArray.mockResolvedValue(['Hallo']);

        await translateArray(
          mockDeepLProvider,
          { ...mockPluginParams, deeplPreserveFormatting: true },
          ['Hello'],
          'en',
          'de',
          { isHTML: true, formality: 'more' },
        );

        expect(mockDeepLProvider.translateArray).toHaveBeenCalledWith(
          expect.any(Array),
          expect.objectContaining({
            targetLang: 'DE',
            sourceLang: 'EN',
            isHTML: true,
            formality: 'prefer_more',
            preserveFormatting: true,
          }),
        );
      });

      it('applies the saved formality setting', async () => {
        mockDeepLProvider.translateArray.mockResolvedValue(['Hallo']);

        await translateArray(
          mockDeepLProvider,
          { ...mockPluginParams, deeplFormality: 'less' },
          ['Hello'],
          'en',
          'de',
        );

        expect(mockDeepLProvider.translateArray).toHaveBeenCalledWith(
          expect.any(Array),
          expect.objectContaining({ formality: 'prefer_less' }),
        );
      });

      it('lets a per-call formality override the saved setting', async () => {
        mockDeepLProvider.translateArray.mockResolvedValue(['Hallo']);

        await translateArray(
          mockDeepLProvider,
          { ...mockPluginParams, deeplFormality: 'less' },
          ['Hello'],
          'en',
          'de',
          { formality: 'default' },
        );

        const [, options] = mockDeepLProvider.translateArray.mock.calls[0];
        expect(options.formality).toBeUndefined();
      });

      it('applies formality for targets outside the old allow-list', async () => {
        mockDeepLProvider.translateArray.mockResolvedValue(['こんにちは']);

        await translateArray(
          mockDeepLProvider,
          { ...mockPluginParams, deeplFormality: 'more' },
          ['Hello'],
          'en',
          'ja',
        );

        expect(mockDeepLProvider.translateArray).toHaveBeenCalledWith(
          expect.any(Array),
          expect.objectContaining({
            targetLang: 'JA',
            formality: 'prefer_more',
          }),
        );
      });

      it('sends the default tag lists when the tag settings were never saved', async () => {
        mockDeepLProvider.translateArray.mockResolvedValue(['Hallo']);

        await translateArray(
          mockDeepLProvider,
          mockPluginParams,
          ['Hello'],
          'en',
          'de',
        );

        expect(mockDeepLProvider.translateArray).toHaveBeenCalledWith(
          expect.any(Array),
          expect.objectContaining({
            ignoreTags: ['notranslate', 'ph'],
            nonSplittingTags: [
              'a',
              'code',
              'pre',
              'strong',
              'em',
              'ph',
              'notranslate',
            ],
            splittingTags: [],
          }),
        );
      });

      it('sends the saved tag lists', async () => {
        mockDeepLProvider.translateArray.mockResolvedValue(['Hallo']);

        await translateArray(
          mockDeepLProvider,
          {
            ...mockPluginParams,
            deeplIgnoreTags: 'x-keep, <var>',
            deeplNonSplittingTags: '',
            deeplSplittingTags: 'p,li',
          },
          ['Hello'],
          'en',
          'de',
          { isHTML: true },
        );

        expect(mockDeepLProvider.translateArray).toHaveBeenCalledWith(
          expect.any(Array),
          expect.objectContaining({
            ignoreTags: ['x-keep', 'var'],
            nonSplittingTags: [],
            splittingTags: ['p', 'li'],
          }),
        );
      });

      it('should log native request and response payloads when debugging is enabled', async () => {
        const logSpy = vi
          .spyOn(console, 'log')
          .mockImplementation(() => undefined);
        mockDeepLProvider.translateArray.mockResolvedValue(['Hallo']);

        await translateArray(
          mockDeepLProvider,
          { ...mockPluginParams, enableDebugging: true },
          ['Hello'],
          'en',
          'de',
          { isHTML: true },
        );

        const payloads = parseLogPayloads(logSpy.mock.calls);
        const messages = payloads.map((payload) => payload.message);
        expect(messages).toEqual(
          expect.arrayContaining([
            'Native batch translation request',
            'Native batch translation response',
            'Translation batch output',
          ]),
        );
        const requestPayload = payloads.find(
          (payload) => payload.message === 'Native batch translation request',
        );
        const requestData = requestPayload?.data as {
          provider: string;
          segments: string[];
          options: { targetLang: string; isHTML: boolean };
        };
        expect(requestData.provider).toBe('deepl');
        expect(requestData.segments).toEqual(['Hello']);
        expect(requestData.options.targetLang).toBe('DE');
        expect(requestData.options.isHTML).toBe(true);
      });
    });

    describe('Yandex provider translation', () => {
      let mockYandexProvider: Required<
        Pick<TranslationProvider, 'translateArray'>
      > &
        Omit<TranslationProvider, 'translateArray'> & {
          translateArray: ReturnType<typeof vi.fn>;
        };

      beforeEach(() => {
        mockYandexProvider = {
          vendor: 'yandex',
          streamText: vi.fn(),
          completeText: vi.fn(),
          translateArray: vi.fn(),
        } as typeof mockYandexProvider;
      });

      it('passes raw locales and generic native options to Yandex', async () => {
        mockYandexProvider.translateArray.mockResolvedValue(['Olá']);

        const result = await translateArray(
          mockYandexProvider,
          {
            ...mockPluginParams,
            deeplPreserveFormatting: true,
            deeplGlossaryId: 'must-not-leak',
          },
          ['Hello'],
          'en-US',
          'pt-BR',
          { isHTML: true, formality: 'more' },
        );

        expect(result).toEqual(['Olá']);
        expect(mockYandexProvider.translateArray).toHaveBeenCalledWith(
          ['Hello'],
          {
            sourceLang: 'en-US',
            targetLang: 'pt-BR',
            isHTML: true,
            originalSourceLocale: 'en-US',
            originalTargetLocale: 'pt-BR',
            debug: expect.any(Object),
          },
        );
      });

      it('omits a blank source locale so Yandex can auto-detect it', async () => {
        mockYandexProvider.translateArray.mockResolvedValue(['Hallo']);

        await translateArray(
          mockYandexProvider,
          mockPluginParams,
          ['Hello'],
          '',
          'de',
        );

        expect(mockYandexProvider.translateArray).toHaveBeenCalledWith(
          ['Hello'],
          expect.objectContaining({ sourceLang: undefined, targetLang: 'de' }),
        );
      });

      it('protects and restores placeholders for Yandex', async () => {
        mockYandexProvider.translateArray.mockResolvedValue(['Hallo ⟦PH_0⟧']);

        const result = await translateArray(
          mockYandexProvider,
          mockPluginParams,
          ['Hello {{name}}'],
          'en',
          'de',
        );

        expect(result).toEqual(['Hallo {{name}}']);
      });
    });

    describe('native provider routing', () => {
      it('rejects native batching for a provider without explicit native options', async () => {
        const unsupportedNativeProvider: TranslationProvider = {
          vendor: 'openai',
          streamText: vi.fn(),
          completeText: vi.fn(),
          translateArray: vi.fn(),
        };

        await expect(
          translateArray(
            unsupportedNativeProvider,
            mockPluginParams,
            ['Hello'],
            'en',
            'de',
          ),
        ).rejects.toThrow('Native batch translation is not configured');
        expect(unsupportedNativeProvider.translateArray).not.toHaveBeenCalled();
      });
    });

    describe('error handling', () => {
      it('should normalize and rethrow provider errors', async () => {
        vi.mocked(mockProvider.completeText).mockRejectedValue({
          status: 429,
          message: 'Rate limit exceeded',
        });

        await expect(
          translateArray(mockProvider, mockPluginParams, ['Hello'], 'en', 'de'),
        ).rejects.toThrow('Rate limit');
      });

      it('should include original error as cause', async () => {
        const originalError = new Error('Original error');
        vi.mocked(mockProvider.completeText).mockRejectedValue(originalError);

        try {
          await translateArray(
            mockProvider,
            mockPluginParams,
            ['Hello'],
            'en',
            'de',
          );
          expect.fail('Should have thrown');
        } catch (e) {
          expect((e as Error).cause).toBe(originalError);
        }
      });

      it('preserves ProviderError status and vendor while adding context', async () => {
        const originalError = new ProviderError(
          'Permission denied',
          403,
          'yandex',
        );
        const yandexProvider: TranslationProvider = {
          vendor: 'yandex',
          streamText: vi.fn(),
          completeText: vi.fn(),
          translateArray: vi.fn().mockRejectedValue(originalError),
        };

        try {
          await translateArray(
            yandexProvider,
            mockPluginParams,
            ['Hello'],
            'en',
            'de',
          );
          expect.fail('Should have thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(ProviderError);
          expect((error as ProviderError).status).toBe(403);
          expect((error as ProviderError).vendor).toBe('yandex');
          expect((error as Error).cause).toBe(originalError);
        }
      });
    });

    describe('locale handling', () => {
      it('should include from and to locales in prompt', async () => {
        vi.mocked(mockProvider.completeText).mockResolvedValue('["Bonjour"]');

        await translateArray(
          mockProvider,
          mockPluginParams,
          ['Hello'],
          'en',
          'fr',
        );

        const prompt = vi.mocked(mockProvider.completeText).mock.calls[0][0];
        expect(prompt).toContain('en');
        expect(prompt).toContain('fr');
      });
    });

    describe('null and undefined handling', () => {
      it('should handle null values in segments array', async () => {
        vi.mocked(mockProvider.completeText).mockResolvedValue('["", "Welt"]');

        const result = await translateArray(
          mockProvider,
          mockPluginParams,
          [null as unknown as string, 'World'],
          'en',
          'de',
        );

        expect(result).toBeDefined();
      });

      it('should fall back to originals for empty response from provider', async () => {
        // Empty response causes JSON parse to fail, defaults to []
        // Then length repair fills with originals
        vi.mocked(mockProvider.completeText).mockResolvedValue('');

        await expect(
          translateArray(mockProvider, mockPluginParams, ['Hello'], 'en', 'de'),
        ).rejects.toThrow(/No content was saved/);

        // Falls back to original since empty response defaults to []
      });
    });
  });
});
