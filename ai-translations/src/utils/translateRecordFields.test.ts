/**
 * Integration test for the sidebar record-translation flow. Verifies that the
 * proactive field-length QC guard (the sidebar half of the "silent truncation /
 * field character-limit" fix) reaches the caller's onQcFlag sink, so the user is
 * warned BEFORE saving a value the CMA would reject.
 *
 * The provider, the schema fetch, and the field translator are mocked so the
 * test exercises only the orchestration + QC wiring, not real API calls.
 */

import type { RenderItemFormSidebarPanelCtx } from 'datocms-plugin-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ctxParamsType } from '../entrypoints/Config/ConfigScreen';
import type { QcFlag } from './translation/qc/types';

vi.mock('./translation/ProviderFactory', () => ({
  getProvider: vi.fn(() => ({
    vendor: 'openai',
    streamText: vi.fn(),
    completeText: vi.fn(),
  })),
}));

vi.mock('./translation/TranslateField', () => ({
  translateFieldValue: vi.fn(),
  generateRecordContext: vi.fn(() => ''),
}));

import { translateFieldValue } from './translation/TranslateField';
import { translateRecordFields } from './translateRecordFields';

const pluginParams: ctxParamsType = {
  apiKey: 'test-key',
  gptModel: 'gpt-4',
  translationFields: ['single_line'],
  translateWholeRecord: true,
  translateBulkRecords: true,
  prompt: '',
  modelsToBeExcludedFromThisPlugin: [],
  rolesToBeExcludedFromThisPlugin: [],
  apiKeysToBeExcludedFromThisPlugin: [],
  enableDebugging: false,
};

/** Builds a minimal sidebar ctx with one localized single_line field. */
function buildCtx(validators: Record<string, unknown>): RenderItemFormSidebarPanelCtx {
  return {
    formValues: {
      internalLocales: ['en', 'it'],
      title: { en: 'Hello' },
    },
    fields: {
      'field-title': {
        id: 'field-title',
        attributes: {
          api_key: 'title',
          label: 'Title',
          localized: true,
          appearance: { editor: 'single_line' },
          validators,
        },
        relationships: { item_type: { data: { id: 'item-type-1' } } },
      },
    },
    itemType: { id: 'item-type-1' },
    currentUserAccessToken: 'token',
    environment: 'main',
    cmaBaseUrl: undefined,
    setFieldValue: vi.fn().mockResolvedValue(undefined),
  } as unknown as RenderItemFormSidebarPanelCtx;
}

describe('translateRecordFields — length-validator QC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits a length-validator error flag when the translation overflows the field limit', async () => {
    vi.mocked(translateFieldValue).mockResolvedValue('Ciao mondo bellissimo');
    const ctx = buildCtx({ length: { max: 5 } });
    const flags: QcFlag[] = [];

    await translateRecordFields(ctx, pluginParams, ['it'], 'en', {
      onQcFlag: (flag) => flags.push(flag),
    });

    const lengthFlag = flags.find((f) => f.checkId === 'length-validator');
    expect(lengthFlag).toBeDefined();
    expect(lengthFlag?.severity).toBe('error');
    expect(lengthFlag?.locale).toBe('it');
  });

  it('does not emit a length-validator flag when the translation fits', async () => {
    vi.mocked(translateFieldValue).mockResolvedValue('Ciao');
    const ctx = buildCtx({ length: { max: 50 } });
    const flags: QcFlag[] = [];

    await translateRecordFields(ctx, pluginParams, ['it'], 'en', {
      onQcFlag: (flag) => flags.push(flag),
    });

    expect(flags.some((f) => f.checkId === 'length-validator')).toBe(false);
  });
});
