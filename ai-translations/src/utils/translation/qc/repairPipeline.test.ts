/**
 * Grounds the parse → repair → QC pipeline in real-world model output shapes.
 * Most fixtures are captured by test/capture-provider-responses.mjs (Gemini's
 * default ```json fencing, a truncated-and-unparseable response); the over-split
 * multi-block HTML fixture is hand-authored — synthetic content modeled on the
 * reported cropping bug — since live models only over-split intermittently. The
 * raw model text is replayed through `translateArray` via a mocked provider.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ctxParamsType } from '../../../entrypoints/Config/ConfigScreen';
import { translateArray } from '../translateArray';
import type { TranslationProvider } from '../types';
import type { QcFlag } from './types';

const params: ctxParamsType = {
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

// biome-ignore lint/suspicious/noExplicitAny: raw provider fixture JSON
function fixture(provider: string, scenario: string): any {
  // Resolved against the package root — vitest's cwd, where `npm test` runs.
  return JSON.parse(
    readFileSync(
      join(
        process.cwd(),
        'test/fixtures/provider-responses',
        provider,
        `${scenario}.json`,
      ),
      'utf8',
    ),
  );
}

// biome-ignore lint/suspicious/noExplicitAny: raw provider fixture JSON
function finishReason(fx: any): string {
  if (fx.provider === 'openai') return fx.response.choices[0].finish_reason;
  if (fx.provider === 'gemini') return fx.response.candidates[0].finishReason;
  throw new Error(`no finishReason for ${fx.provider}`);
}

// biome-ignore lint/suspicious/noExplicitAny: raw provider fixture JSON
function modelText(fx: any): string {
  if (fx.provider === 'openai')
    return fx.response.choices?.[0]?.message?.content ?? '';
  if (fx.provider === 'gemini') {
    // A truncated Gemini candidate can carry no `content.parts` at all.
    const parts = fx.response.candidates?.[0]?.content?.parts;
    return Array.isArray(parts)
      ? parts.map((p: { text?: string }) => p.text ?? '').join('')
      : '';
  }
  throw new Error(`no text extractor for ${fx.provider}`);
}

function textProvider(text: string): TranslationProvider {
  return {
    vendor: 'google',
    streamText: vi.fn(),
    completeText: vi.fn().mockResolvedValue(text),
  };
}

function metaProvider(text: string, finishReason: string): TranslationProvider {
  return {
    vendor: 'openai',
    streamText: vi.fn(),
    completeText: vi.fn(),
    completeTextWithMeta: vi.fn().mockResolvedValue({ text, finishReason }),
  };
}

describe('repair + QC pipeline against real captured outputs', () => {
  it('parses Gemini default ```json-fenced output with no flags when length matches', async () => {
    const fx = fixture('gemini', 'array-baseline');
    const flags: QcFlag[] = [];

    const result = await translateArray(
      textProvider(modelText(fx)),
      params,
      ['Workflow tools headline', 'Automation feature description'],
      'en',
      'fr',
      { onQcFlag: (f) => flags.push(f) },
    );

    expect(result).toHaveLength(2);
    expect(flags.some((f) => f.checkId === 'length-mismatch')).toBe(false);
    expect(flags.some((f) => f.checkId === 'truncated')).toBe(false);
  });

  it('recovers an over-split HTML field: flags length-mismatch and keeps BOTH paragraphs', async () => {
    const fx = fixture('gemini', 'html-multiblock-oversplit');
    const source = fx.request.segments[0] as string;
    const flags: QcFlag[] = [];

    const result = await translateArray(
      textProvider(modelText(fx)),
      params,
      [source],
      'en',
      'nl',
      { isHTML: true, onQcFlag: (f) => flags.push(f) },
    );

    // Clean recovery: the over-split is rejoined losslessly, so it is NOT
    // mislabelled as a length-mismatch and emits no error flags.
    expect(flags.some((f) => f.severity === 'error')).toBe(false);
    expect(result).toHaveLength(1);
    // The old bug cropped the second paragraph; both must now survive.
    expect(result[0]).toContain('data-path-to-node="0"');
    expect(result[0]).toContain('data-path-to-node="1"');
  });

  it('flags truncation and falls back to source for a truncated, unparseable OpenAI response', async () => {
    const fx = fixture('openai', 'truncated'); // partial, unparseable, finish=length
    const flags: QcFlag[] = [];

    const result = await translateArray(
      metaProvider(modelText(fx), finishReason(fx)),
      params,
      ['First segment', 'Second segment'],
      'en',
      'fr',
      { onQcFlag: (f) => flags.push(f) },
    );

    expect(flags.some((f) => f.checkId === 'truncated')).toBe(true);
    expect(result).toEqual(['First segment', 'Second segment']);
  });

  it('flags truncation and falls back to source for a truncated, empty Gemini response', async () => {
    const fx = fixture('gemini', 'truncated'); // no content.parts, finish=MAX_TOKENS
    const flags: QcFlag[] = [];

    const result = await translateArray(
      metaProvider(modelText(fx), finishReason(fx)),
      params,
      ['First segment', 'Second segment'],
      'en',
      'fr',
      { onQcFlag: (f) => flags.push(f) },
    );

    expect(flags.some((f) => f.checkId === 'truncated')).toBe(true);
    expect(result).toEqual(['First segment', 'Second segment']);
  });
});
