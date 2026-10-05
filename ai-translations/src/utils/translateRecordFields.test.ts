import type { RenderItemFormSidebarPanelCtx } from 'datocms-plugin-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ctxParamsType } from '../entrypoints/Config/ConfigScreen';
import { translateRecordFields } from './translateRecordFields';
import { translateFieldValue } from './translation/TranslateField';
import { ProviderError } from './translation/types';

vi.mock('./clients', () => ({ buildDatoCMSClient: vi.fn() }));
vi.mock('./schemaRepository', () => ({ createSchemaRepository: () => ({}) }));
vi.mock('./translation/ProviderFactory', () => ({
  getProvider: () => ({ vendor: 'openai' }),
}));
vi.mock('./translation/TranslateField', () => ({
  generateRecordContext: () => '',
  translateFieldValue: vi.fn(),
}));

const params: ctxParamsType = {
  apiKey: 'synthetic-key', gptModel: 'gpt-4', translationFields: ['single_line'],
  translateWholeRecord: true, translateBulkRecords: true, prompt: '',
  modelsToBeExcludedFromThisPlugin: [], rolesToBeExcludedFromThisPlugin: [],
  apiKeysToBeExcludedFromThisPlugin: [], enableDebugging: false,
};

function createContext(fieldCount: number) {
  const fields = Object.fromEntries(Array.from({ length: fieldCount }, (_, index) => [`field-${index}`, {
    id: `field-${index}`,
    attributes: { api_key: `title_${index}`, label: `Title ${index}`, localized: true,
      appearance: { editor: 'single_line' }, validators: {} },
    relationships: { item_type: { data: { id: 'model-one' } } },
  }]));
  const formValues = { internalLocales: ['en', 'it', 'fr'], ...Object.fromEntries(Array.from({ length: fieldCount }, (_, index) => [`title_${index}`, { en: `Source ${index}` }])) };
  const setFieldValue = vi.fn(async () => undefined);
  const ctx = { fields, formValues, itemType: { id: 'model-one' }, currentUserAccessToken: 'synthetic-cma-token', environment: 'main', setFieldValue } as unknown as RenderItemFormSidebarPanelCtx;
  return { ctx, setFieldValue, formValues };
}

describe('translateRecordFields continuous workers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(translateFieldValue).mockResolvedValue('Translated');
  });
  afterEach(() => vi.useRealTimers());

  it('settles immediately with zero eligible jobs and excludes duplicate/source locales', async () => {
    const empty = createContext(0);
    await translateRecordFields(empty.ctx, params, ['it'], 'en');
    expect(empty.setFieldValue).not.toHaveBeenCalled();
    const single = createContext(1);
    const run = translateRecordFields(single.ctx, params, ['en', 'EN', 'it', 'it'], 'en');
    await vi.runAllTimersAsync();
    await run;
    expect(single.setFieldValue).toHaveBeenCalledTimes(1);
    expect(single.setFieldValue).toHaveBeenCalledWith('title_0.it', 'Translated');
  });

  it('waits for in-flight translations to settle after cancellation and makes no late form writes', async () => {
    const { ctx, setFieldValue } = createContext(20);
    const pending: Array<(value: unknown) => void> = [];
    vi.mocked(translateFieldValue).mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    const controller = new AbortController();
    let finished = false;
    const run = translateRecordFields(ctx, params, ['it'], 'en', { abortSignal: controller.signal }).then(() => { finished = true; });
    expect(pending).toHaveLength(4);
    controller.abort();
    await Promise.resolve();
    expect(finished).toBe(false);
    for (const resolve of pending) resolve('Late translation');
    await run;
    expect(setFieldValue).not.toHaveBeenCalled();
    expect(translateFieldValue).toHaveBeenCalledTimes(4);
  });

  it('reports partial failures without replaying successful nested provider chunks', async () => {
    const { ctx, setFieldValue } = createContext(2);
    vi.mocked(translateFieldValue).mockRejectedValueOnce(new ProviderError('Rate limit after completed chunks', 429, 'openai'));
    const onError = vi.fn();
    const run = translateRecordFields(ctx, params, ['it'], 'en', { onError });
    await vi.runAllTimersAsync();
    await run;
    expect(translateFieldValue).toHaveBeenCalledTimes(2);
    expect(setFieldValue).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('propagates fatal credentials and stops queued jobs', async () => {
    const { ctx, setFieldValue } = createContext(20);
    vi.mocked(translateFieldValue).mockRejectedValue(new ProviderError('Invalid API key', 401, 'openai'));
    const run = translateRecordFields(ctx, params, ['it'], 'en');
    await expect(run).rejects.toMatchObject({ status: 401, vendor: 'openai' });
    expect(translateFieldValue).toHaveBeenCalledTimes(4);
    expect(setFieldValue).not.toHaveBeenCalled();
  });
});
