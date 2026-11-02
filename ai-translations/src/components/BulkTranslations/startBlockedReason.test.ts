import { describe, expect, it } from 'vitest';
import type {
  TranslatableField,
  TranslationReadiness,
} from '../../utils/translation/BulkTranslationHelpers';
import { getStartBlockedReason } from './startBlockedReason';

const READY: TranslationReadiness = {
  isReady: true,
  missingSourceLocale: false,
  missingTargetLocales: false,
  missingModels: false,
  modelsMissingFields: [],
};

const titleField: TranslatableField = {
  id: 'title-field',
  apiKey: 'title',
  label: 'Title',
  editor: 'single_line',
};

const models = [
  { value: 'article', label: 'Articles' },
  { value: 'page', label: 'Pages' },
];

type Args = Parameters<typeof getStartBlockedReason>[0];

function args(overrides: Partial<Args> = {}): Args {
  return {
    providerConfigured: true,
    readiness: READY,
    models,
    pendingModelIds: new Set(),
    failedModelIds: new Set(),
    fieldsByModel: { article: [titleField], page: [titleField] },
    requireModels: true,
    ...overrides,
  };
}

function notReady(overrides: Partial<TranslationReadiness>) {
  return { ...READY, isReady: false, ...overrides };
}

describe('getStartBlockedReason', () => {
  it('returns null when ready and a provider is configured', () => {
    expect(getStartBlockedReason(args())).toBeNull();
  });

  it('explains a missing provider first', () => {
    expect(
      getStartBlockedReason(
        args({
          providerConfigured: false,
          readiness: notReady({
            missingSourceLocale: true,
            missingModels: true,
          }),
        }),
      ),
    ).toBe('Set up an AI vendor in the plugin settings first.');
  });

  it('explains a missing source locale before missing targets', () => {
    expect(
      getStartBlockedReason(
        args({
          readiness: notReady({
            missingSourceLocale: true,
            missingTargetLocales: true,
          }),
        }),
      ),
    ).toBe('Pick the locale to translate from first.');
  });

  it('explains missing target locales before missing models', () => {
    expect(
      getStartBlockedReason(
        args({
          readiness: notReady({
            missingTargetLocales: true,
            missingModels: true,
          }),
        }),
      ),
    ).toBe('Pick at least one locale to translate into.');
  });

  it('explains missing models when they are required', () => {
    expect(
      getStartBlockedReason(
        args({
          models: [],
          fieldsByModel: {},
          readiness: notReady({ missingModels: true }),
        }),
      ),
    ).toBe('Pick at least one model first.');
  });

  it('skips the models reason in priority order when models are not required', () => {
    const blocked = args({
      failedModelIds: new Set(['page']),
      readiness: notReady({ missingModels: true }),
    });
    expect(getStartBlockedReason(blocked)).toBe(
      'Pick at least one model first.',
    );
    expect(getStartBlockedReason({ ...blocked, requireModels: false })).toBe(
      "The fields of Pages couldn't be loaded. Try loading them again.",
    );
  });

  it('never returns null while not ready, even without models required', () => {
    expect(
      getStartBlockedReason(
        args({
          models: [],
          fieldsByModel: {},
          requireModels: false,
          readiness: notReady({ missingModels: true }),
        }),
      ),
    ).not.toBeNull();
  });

  it('explains the first model whose fields are loading', () => {
    expect(
      getStartBlockedReason(
        args({
          pendingModelIds: new Set(['page', 'article']),
          failedModelIds: new Set(['article']),
          fieldsByModel: {},
          readiness: notReady({ modelsMissingFields: ['article', 'page'] }),
        }),
      ),
    ).toBe('Wait for the fields of Articles to load.');
  });

  it('explains a failed field load before a dead end', () => {
    expect(
      getStartBlockedReason(
        args({
          failedModelIds: new Set(['page']),
          fieldsByModel: { article: [] },
          readiness: notReady({ modelsMissingFields: ['article', 'page'] }),
        }),
      ),
    ).toBe("The fields of Pages couldn't be loaded. Try loading them again.");
  });

  it('explains a model with no translatable fields before an empty selection', () => {
    expect(
      getStartBlockedReason(
        args({
          fieldsByModel: { article: [titleField], page: [] },
          readiness: notReady({ modelsMissingFields: ['article', 'page'] }),
        }),
      ),
    ).toBe('Pages has no fields the plugin can translate.');
  });

  it('explains the first model with no field selected', () => {
    expect(
      getStartBlockedReason(
        args({
          readiness: notReady({ modelsMissingFields: ['page'] }),
        }),
      ),
    ).toBe('Pick at least one field of Pages first.');
  });
});
