/**
 * Tests for translateArray.ts
 * Tests placeholder tokenization, detokenization, and array translation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';
import { isSystemicError, normalizeProviderError } from './ProviderErrors';
import type { QcFlag } from './qc/types';
import { tokenize, translateArray } from './translateArray';
import type { TranslationProvider } from './types';

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

      it('should rejoin when the model splits a single Markdown segment into multiple elements', async () => {
        // Same over-split failure mode as HTML, markdown flavour: a markdown
        // field is sent as ONE segment holding several blocks; the model
        // returns one element per block. Positional repair would crop the value
        // to its first block (silent data loss) — instead the elements are
        // rejoined with a blank line, the markdown block boundary.
        vi.mocked(mockProvider.completeText).mockResolvedValue(
          '["## Introducción", "Primer párrafo del cuerpo.", "Segundo párrafo del cuerpo."]',
        );

        const result = await translateArray(
          mockProvider,
          mockPluginParams,
          ['## Intro\n\nBody paragraph one.\n\nBody paragraph two.'],
          'en',
          'es',
          { kind: 'markdown' },
        );

        expect(result).toEqual([
          '## Introducción\n\nPrimer párrafo del cuerpo.\n\nSegundo párrafo del cuerpo.',
        ]);
      });

      it('should NOT rejoin an over-split plain-text segment (avoids corrupting single_line/json/slug)', async () => {
        // The rejoin recovery covers block content (html/markdown) only. For a
        // plain single-line value, injecting separators would corrupt it, so the
        // positional length repair (keep the first element) is retained.
        vi.mocked(mockProvider.completeText).mockResolvedValue(
          '["Rojo", "verde", "azul"]',
        );

        const result = await translateArray(
          mockProvider,
          mockPluginParams,
          ['Red, green, blue'],
          'en',
          'es',
        );

        expect(result).toEqual(['Rojo']);
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

      it('should recover a single-quoted array the model returned instead of JSON', async () => {
        // Reproduces the "single quotes only translated after 3-4 retries" bug:
        // the model emits a JS/Python-style single-quoted array, which strict
        // JSON.parse + bracket-extraction both reject. It must now recover on
        // the first attempt instead of throwing.
        vi.mocked(mockProvider.completeText).mockResolvedValue(
          "['Aujourd\\'hui', 'L\\'hôtel est ouvert']",
        );

        const result = await translateArray(
          mockProvider,
          mockPluginParams,
          ["Today", "The hotel is open"],
          'en',
          'fr',
        );

        expect(result).toEqual(["Aujourd'hui", 'L\'hôtel est ouvert']);
      });

      it('should recover a single-quoted array wrapped in a markdown fence', async () => {
        vi.mocked(mockProvider.completeText).mockResolvedValue(
          "```json\n['Hallo', 'Welt']\n```",
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
            payload.message === 'Response repaired by extracting array brackets',
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

        const result = await translateArray(
          mockProvider,
          mockPluginParams,
          ['Hello', 'World'],
          'en',
          'de',
        );

        expect(result).toEqual(['Hallo', 'World']);
      });

      it('should rejoin when model splits a single HTML segment into multiple elements', async () => {
        // Regression: a WYSIWYG field is sent as one segment containing several
        // block-level <p> elements. Chat models frequently "helpfully" split it
        // into one array element per block, returning more elements than were
        // sent. For HTML the length repair must rejoin them (newlines between
        // block elements are insignificant) instead of dropping the tail.
        vi.mocked(mockProvider.completeText).mockResolvedValue(
          '["<p>Eerste paragraaf.</p>", "<p>Tweede paragraaf.</p>"]',
        );

        const result = await translateArray(
          mockProvider,
          mockPluginParams,
          ['<p>First paragraph.</p>\n<p>Second paragraph.</p>'],
          'en',
          'nl',
          { isHTML: true },
        );

        expect(result).toEqual([
          '<p>Eerste paragraaf.</p>\n<p>Tweede paragraaf.</p>',
        ]);
      });

      it('should NOT rejoin an over-split non-HTML segment (avoids corrupting single_line/json)', async () => {
        // The newline-rejoin recovery is gated to HTML only. For a plain
        // single-line value, injecting newlines would corrupt it, so the
        // positional length repair (keep the first element) is used instead.
        vi.mocked(mockProvider.completeText).mockResolvedValue(
          '["Rojo", "verde", "azul"]',
        );

        const result = await translateArray(
          mockProvider,
          mockPluginParams,
          ['Red, green, blue'],
          'en',
          'es',
        );

        expect(result).toEqual(['Rojo']);
      });

      it('should handle non-string values in response', async () => {
        vi.mocked(mockProvider.completeText).mockResolvedValue(
          '[123, null, "Welt"]',
        );

        const result = await translateArray(
          mockProvider,
          mockPluginParams,
          ['Hello', 'Goodbye', 'World'],
          'en',
          'de',
        );

        // Non-strings should be replaced with originals
        expect(result[2]).toBe('Welt');
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

    describe('error normalization boundary', () => {
      it('keeps a 401 classified as systemic "auth" after being re-thrown', async () => {
        // Regression: translateArray used to rethrow a bare Error carrying only
        // the friendly message, so a downstream re-normalization saw no status
        // and no auth keywords and collapsed 'auth' → 'unknown' — which is not
        // systemic, so the bulk run failed every field instead of pausing.
        const authError = Object.assign(new Error('Unauthorized'), {
          status: 401,
        });
        vi.mocked(mockProvider.completeText).mockRejectedValue(authError);

        const caught = await translateArray(
          mockProvider,
          mockPluginParams,
          ['Hello'],
          'en',
          'de',
        ).catch((error) => error);

        const norm = normalizeProviderError(caught, 'openai');
        expect(norm.code).toBe('auth');
        expect(isSystemicError(norm)).toBe(true);
      });
    });

    describe('QC flags', () => {
      it('emits a length-mismatch flag when the model over-splits a single segment', async () => {
        vi.mocked(mockProvider.completeText).mockResolvedValue('["a","b"]');
        const flags: QcFlag[] = [];

        await translateArray(mockProvider, mockPluginParams, ['x'], 'en', 'de', {
          onQcFlag: (f) => flags.push(f),
        });

        expect(flags.some((f) => f.checkId === 'length-mismatch')).toBe(true);
      });

      it('emits a source-fallback warning when a matched-length element reverts to source', async () => {
        // Length matches (3 in / 3 out) so no length-mismatch fires, but the
        // middle element is JSON null: positional repair keeps the untranslated
        // source for that slot, which must be surfaced rather than silent.
        vi.mocked(mockProvider.completeText).mockResolvedValue(
          '["Hallo", null, "Welt"]',
        );
        const flags: QcFlag[] = [];

        await translateArray(
          mockProvider,
          mockPluginParams,
          ['Hello', 'Goodbye', 'World'],
          'en',
          'de',
          { onQcFlag: (f) => flags.push(f) },
        );

        const flag = flags.find((f) => f.checkId === 'source-fallback');
        expect(flag?.severity).toBe('warning');
        expect(flags.some((f) => f.checkId === 'length-mismatch')).toBe(false);
      });

      it('emits no flags on a clean, length-matched response', async () => {
        vi.mocked(mockProvider.completeText).mockResolvedValue('["a","b"]');
        const flags: QcFlag[] = [];

        await translateArray(
          mockProvider,
          mockPluginParams,
          ['x', 'y'],
          'en',
          'de',
          { onQcFlag: (f) => flags.push(f) },
        );

        expect(flags).toHaveLength(0);
      });

      it('emits a placeholder-loss flag when a protected token is dropped', async () => {
        // Model returns the translation without the protected {{name}} token.
        vi.mocked(mockProvider.completeText).mockResolvedValue('["Hallo"]');
        const flags: QcFlag[] = [];

        await translateArray(
          mockProvider,
          mockPluginParams,
          ['Hello {{name}}'],
          'en',
          'de',
          { onQcFlag: (f) => flags.push(f) },
        );

        expect(flags.some((f) => f.checkId === 'placeholder-loss')).toBe(true);
      });

      it('emits a truncated flag when the provider reports a cut-off', async () => {
        const metaProvider: TranslationProvider = {
          vendor: 'openai',
          streamText: vi.fn(),
          completeText: vi.fn(),
          completeTextWithMeta: vi
            .fn()
            .mockResolvedValue({ text: '["Hallo"]', finishReason: 'length' }),
        };
        const flags: QcFlag[] = [];

        await translateArray(
          metaProvider,
          mockPluginParams,
          ['Hello'],
          'en',
          'de',
          { onQcFlag: (f) => flags.push(f) },
        );

        expect(flags.some((f) => f.checkId === 'truncated')).toBe(true);
      });

      it('suppresses source-fallback when the field is already flagged truncated', async () => {
        // A truncated response leaves the tail source-padded; `truncated` already
        // condemns the field, so the `source-fallback` count is redundant noise.
        const metaProvider: TranslationProvider = {
          vendor: 'openai',
          streamText: vi.fn(),
          completeText: vi.fn(),
          completeTextWithMeta: vi
            .fn()
            .mockResolvedValue({ text: '["Hallo"]', finishReason: 'length' }),
        };
        const flags: QcFlag[] = [];

        await translateArray(
          metaProvider,
          mockPluginParams,
          ['Hello', 'World'],
          'en',
          'de',
          { onQcFlag: (f) => flags.push(f) },
        );

        expect(flags.some((f) => f.checkId === 'truncated')).toBe(true);
        expect(flags.some((f) => f.checkId === 'source-fallback')).toBe(false);
      });

      it('emits an html-structure flag when a block is dropped (isHTML)', async () => {
        vi.mocked(mockProvider.completeText).mockResolvedValue('["<p>x</p>"]');
        const flags: QcFlag[] = [];

        await translateArray(
          mockProvider,
          mockPluginParams,
          ['<p>a</p><p>b</p>'],
          'en',
          'de',
          { isHTML: true, onQcFlag: (f) => flags.push(f) },
        );

        expect(flags.some((f) => f.checkId === 'html-structure')).toBe(true);
      });

      it('emits a markdown-structure flag when a heading is dropped (kind=markdown)', async () => {
        vi.mocked(mockProvider.completeText).mockResolvedValue(
          JSON.stringify(['Alinea zonder kop']),
        );
        const flags: QcFlag[] = [];

        await translateArray(
          mockProvider,
          mockPluginParams,
          ['## Title\n\nParagraph here'],
          'en',
          'de',
          { kind: 'markdown', onQcFlag: (f) => flags.push(f) },
        );

        expect(flags.some((f) => f.checkId === 'markdown-structure')).toBe(true);
      });

      it('emits a no-op warning when the value is returned unchanged', async () => {
        vi.mocked(mockProvider.completeText).mockResolvedValue(
          JSON.stringify(['Hello world this is some text']),
        );
        const flags: QcFlag[] = [];

        await translateArray(
          mockProvider,
          mockPluginParams,
          ['Hello world this is some text'],
          'en',
          'de',
          { onQcFlag: (f) => flags.push(f) },
        );

        expect(flags.some((f) => f.checkId === 'no-op')).toBe(true);
      });

      it('suppresses length-ratio when a hard error already fired on the field', async () => {
        vi.mocked(mockProvider.completeText).mockResolvedValue(
          JSON.stringify(['tiny', 'extra']),
        );
        const flags: QcFlag[] = [];

        await translateArray(
          mockProvider,
          mockPluginParams,
          ['This is a long enough source sentence to matter.'],
          'en',
          'de',
          { onQcFlag: (f) => flags.push(f) },
        );

        expect(flags.some((f) => f.checkId === 'length-mismatch')).toBe(true);
        expect(flags.some((f) => f.checkId === 'length-ratio')).toBe(false);
      });

      it('keeps length-ratio on a clean segment when another segment has a per-segment error', async () => {
        // seg 0 drops its placeholder (per-segment error, segmentIndex 0);
        // seg 1 is heavily truncated and should still raise its own ratio flag.
        vi.mocked(mockProvider.completeText).mockResolvedValue(
          JSON.stringify(['Hello this is fine length here', 'tiny']),
        );
        const flags: QcFlag[] = [];

        await translateArray(
          mockProvider,
          mockPluginParams,
          [
            'Hello {{name}} this is fine length here',
            'This is a long enough source sentence to matter.',
          ],
          'en',
          'de',
          { onQcFlag: (f) => flags.push(f) },
        );

        expect(flags.some((f) => f.checkId === 'placeholder-loss')).toBe(true);
        expect(
          flags.some(
            (f) => f.checkId === 'length-ratio' && f.segmentIndex === 1,
          ),
        ).toBe(true);
      });

      it('flags a no-op per segment for independent-field batches (qcAtomicSegments)', async () => {
        // Title returned unchanged, description translated. As independent
        // fields each segment is its own no-op unit, so the unchanged title
        // is flagged even though it is only half the batch.
        vi.mocked(mockProvider.completeText).mockResolvedValue(
          JSON.stringify(['Our company values', 'Beschrijving vertaald hier']),
        );
        const flags: QcFlag[] = [];

        await translateArray(
          mockProvider,
          mockPluginParams,
          ['Our company values', 'Description translated here'],
          'en',
          'de',
          { qcAtomicSegments: true, onQcFlag: (f) => flags.push(f) },
        );

        expect(
          flags.some((f) => f.checkId === 'no-op' && f.segmentIndex === 0),
        ).toBe(true);
      });

      it('does not aggregate independent-field no-ops without qcAtomicSegments', async () => {
        // Same inputs, default (field-aggregate) mode: 1 of 2 unchanged = 50%,
        // not above the >50% threshold, so no field-level no-op fires.
        vi.mocked(mockProvider.completeText).mockResolvedValue(
          JSON.stringify(['Our company values', 'Beschrijving vertaald hier']),
        );
        const flags: QcFlag[] = [];

        await translateArray(
          mockProvider,
          mockPluginParams,
          ['Our company values', 'Description translated here'],
          'en',
          'de',
          { onQcFlag: (f) => flags.push(f) },
        );

        expect(flags.some((f) => f.checkId === 'no-op')).toBe(false);
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
            formality: 'more',
            preserveFormatting: true,
          }),
        );
      });

      it('applies the configured deeplFormality when no per-call formality is given', async () => {
        // Regression: the ConfigScreen's deeplFormality setting previously had
        // NO runtime effect — only the (never-passed) opts.formality was read.
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
          expect.objectContaining({ formality: 'less' }),
        );
      });

      it("treats deeplFormality 'default' as unset and skips unsupported targets", async () => {
        mockDeepLProvider.translateArray.mockResolvedValue(['Hola']);

        // 'default' → omit entirely (let DeepL decide).
        await translateArray(
          mockDeepLProvider,
          { ...mockPluginParams, deeplFormality: 'default' },
          ['Hello'],
          'en',
          'de',
        );
        expect(
          mockDeepLProvider.translateArray.mock.calls[0][1].formality,
        ).toBeUndefined();

        // Formality-unsupported target (e.g. EN) → omitted even when configured.
        mockDeepLProvider.translateArray.mockResolvedValue(['Hello']);
        await translateArray(
          mockDeepLProvider,
          { ...mockPluginParams, deeplFormality: 'more' },
          ['Hallo'],
          'de',
          'en',
        );
        expect(
          mockDeepLProvider.translateArray.mock.calls[1][1].formality,
        ).toBeUndefined();
      });

      it('extends (never replaces) the protective tag lists with the configured deepl*Tags', async () => {
        // Regression: the ConfigScreen's deeplIgnoreTags / deeplNonSplittingTags /
        // deeplSplittingTags settings were ignored (hardcoded lists were sent).
        // User values must EXTEND the baselines — ph/notranslate protect
        // tokenized placeholders and must always survive.
        mockDeepLProvider.translateArray.mockResolvedValue(['Hallo']);

        await translateArray(
          mockDeepLProvider,
          {
            ...mockPluginParams,
            deeplIgnoreTags: 'kbd, samp',
            deeplNonSplittingTags: 'abbr',
            deeplSplittingTags: 'section',
          },
          ['Hello'],
          'en',
          'de',
        );

        const options = mockDeepLProvider.translateArray.mock.calls[0][1];
        expect(options.ignoreTags).toEqual(['notranslate', 'ph', 'kbd', 'samp']);
        expect(options.nonSplittingTags).toEqual([
          'a',
          'code',
          'pre',
          'strong',
          'em',
          'ph',
          'notranslate',
          'abbr',
        ]);
        expect(options.splittingTags).toEqual(['section']);
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
    });

    describe('prompt safety', () => {
      it('should instruct the model not to split elements or change the array length', async () => {
        vi.mocked(mockProvider.completeText).mockResolvedValue('["Hallo"]');

        await translateArray(
          mockProvider,
          mockPluginParams,
          ['<p>a</p>\n<p>b</p>'],
          'en',
          'de',
        );

        const prompt = vi.mocked(mockProvider.completeText).mock.calls[0][0];
        expect(prompt).toContain('exact same length');
        expect(prompt.toLowerCase()).toContain('split');
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

        const result = await translateArray(
          mockProvider,
          mockPluginParams,
          ['Hello'],
          'en',
          'de',
        );

        // Falls back to original since empty response defaults to []
        expect(result).toEqual(['Hello']);
      });
    });
  });
});
