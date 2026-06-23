/**
 * Grounds provider text/finishReason extraction in the REAL response envelopes
 * captured by test/capture-provider-responses.mjs (truncation, multi-candidate,
 * fenced output, structured output). Each fixture's raw `response` is fed back
 * through the provider's `completeTextWithMeta` via a mocked SDK.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreate = vi.fn();
vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } };
  },
}));

const mockGenerateContent = vi.fn();
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class MockGoogleGenerativeAI {
    getGenerativeModel = () => ({
      generateContent: mockGenerateContent,
      generateContentStream: vi.fn(),
    });
  },
}));

import GeminiProvider from './GeminiProvider';
import OpenAIProvider from './OpenAIProvider';

type Fixture = {
  scenario: string;
  ok: boolean;
  response: Record<string, unknown>;
};

function loadOkFixtures(provider: string): Fixture[] {
  // Resolved against the package root — vitest's cwd, where `npm test` runs.
  const dir = join(process.cwd(), 'test/fixtures/provider-responses', provider);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Fixture)
    .filter((fx) => fx.ok);
}

// biome-ignore lint/suspicious/noExplicitAny: fixtures are raw provider JSON
type AnyResponse = any;

describe('Provider extraction from real captured response shapes', () => {
  describe('OpenAI', () => {
    let provider: OpenAIProvider;
    beforeEach(() => {
      vi.useFakeTimers();
      mockCreate.mockReset();
      provider = new OpenAIProvider({ apiKey: 'k', model: 'gpt-4o-mini' });
    });
    afterEach(() => vi.useRealTimers());

    it('has fixtures to exercise', () => {
      expect(loadOkFixtures('openai').length).toBeGreaterThan(0);
    });

    for (const fx of loadOkFixtures('openai')) {
      it(`extracts text + finishReason for "${fx.scenario}"`, async () => {
        const resp = fx.response as AnyResponse;
        mockCreate.mockResolvedValue(resp);
        const result = await provider.completeTextWithMeta('translate');
        expect(result.text).toBe(resp.choices?.[0]?.message?.content ?? '');
        expect(result.finishReason).toBe(
          resp.choices?.[0]?.finish_reason ?? undefined,
        );
      });
    }
  });

  describe('Gemini', () => {
    let provider: GeminiProvider;
    beforeEach(() => {
      vi.useFakeTimers();
      mockGenerateContent.mockReset();
      provider = new GeminiProvider({ apiKey: 'k', model: 'gemini-2.5-flash' });
    });
    afterEach(() => vi.useRealTimers());

    it('has fixtures to exercise', () => {
      expect(loadOkFixtures('gemini').length).toBeGreaterThan(0);
    });

    for (const fx of loadOkFixtures('gemini')) {
      it(`extracts finishReason for "${fx.scenario}"`, async () => {
        const resp = fx.response as AnyResponse;
        const text =
          resp.candidates?.[0]?.content?.parts
            ?.map((p: { text?: string }) => p.text ?? '')
            .join('') ?? '';
        mockGenerateContent.mockResolvedValue({
          response: { ...resp, text: () => text },
        });
        const result = await provider.completeTextWithMeta('translate');
        // finishReason is what our provider actually extracts; the text path
        // just forwards the SDK's text(), so we only assert its contract here.
        expect(typeof result.text).toBe('string');
        expect(result.finishReason).toBe(
          resp.candidates?.[0]?.finishReason ?? undefined,
        );
      });
    }

    it('reads finishReason from the first candidate when several are returned', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          candidates: [
            { finishReason: 'STOP', content: { parts: [{ text: 'ok' }] } },
            { finishReason: 'MAX_TOKENS' },
          ],
          text: () => 'ok',
        },
      });
      const result = await provider.completeTextWithMeta('translate');
      expect(result).toEqual({ text: 'ok', finishReason: 'STOP' });
    });

    it('returns empty text when a truncated candidate has no content parts', async () => {
      mockGenerateContent.mockResolvedValue({
        response: { candidates: [{ finishReason: 'MAX_TOKENS' }], text: () => '' },
      });
      const result = await provider.completeTextWithMeta('translate');
      expect(result).toEqual({ text: '', finishReason: 'MAX_TOKENS' });
    });
  });
});
