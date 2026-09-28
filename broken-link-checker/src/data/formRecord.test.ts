import { buildClient } from '@datocms/cma-client-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extractLinks } from '../extraction/extract';
import { deferred, panelContext } from '../test/fixtures';
import type { ContentField, ContentModel, ContentSchema } from '../types';
import { type FormReadContext, readFormRecord } from './formRecord';

const { rawFind } = vi.hoisted(() => ({ rawFind: vi.fn() }));
vi.mock('@datocms/cma-client-browser', () => ({
  buildClient: vi.fn(() => ({ items: { rawFind } })),
}));

function field(
  apiKey = 'url',
  type = 'string',
  localized = false,
  editor = '',
): ContentField {
  return { id: apiKey, apiKey, label: apiKey, type, localized, editor };
}

function schema(fields: ContentField[], blocks: ContentModel[] = []) {
  return new Map(
    [{ id: 'page', name: 'Page', isBlock: false, fields }, ...blocks].map(
      (model) => [model.id, model],
    ),
  );
}

function item(attributes: Record<string, unknown>, modelId = 'page') {
  return {
    id: `${modelId}-1`,
    type: 'item',
    attributes,
    relationships: { item_type: { data: { id: modelId, type: 'item_type' } } },
  };
}

function context(
  values: Record<string, unknown>,
  attributes: Record<string, unknown> = {},
  overrides: Partial<FormReadContext> = {},
): FormReadContext {
  return {
    ...panelContext(),
    item: { id: 'page-1' } as FormReadContext['item'],
    formValues: { internalLocales: ['en', 'it'], ...values },
    formValuesToItem: vi.fn().mockResolvedValue(item(attributes)),
    itemToFormValues: vi.fn().mockResolvedValue(values),
    ...overrides,
  };
}

const card: ContentModel = {
  id: 'card',
  name: 'Card',
  isBlock: true,
  fields: [field()],
};
const savedCard = item({ url: 'https://card.example/' }, 'card');
const currentCard = {
  itemId: 'card-1',
  itemTypeId: 'card',
  url: 'https://card.example/',
};

function urls(
  record: Parameters<typeof extractLinks>[0],
  models: ContentSchema,
) {
  return extractLinks(record, models, ['en', 'it']).occurrences.map(
    (occurrence) => occurrence.url,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('readFormRecord', () => {
  it('restores readable scalar fields for a read-only user without API access', async () => {
    const models = schema([
      field(),
      field('body', 'text', false, 'markdown'),
      field('empty'),
    ]);
    const values = {
      url: 'https://readable.example/',
      body: '[Link](https://markdown.example/)',
      empty: null,
    };
    const ctx = context(values, {}, { currentUserAccessToken: undefined });
    const result = await readFormRecord(ctx, models, ['en']);
    expect(result.record.values).toEqual(values);
    expect(result.warnings).toEqual([]);
    expect(urls(result.record, models)).toEqual([
      'https://readable.example/',
      'https://markdown.example/',
    ]);
    expect(ctx.formValuesToItem).toHaveBeenCalledWith(ctx.formValues, false);
    expect(rawFind).not.toHaveBeenCalled();
  });

  it('preserves serialized unsaved values and restores only omitted locales', async () => {
    const models = schema([field('url', 'string', true)]);
    const current = {
      url: { en: 'https://changed.example/', it: 'https://readonly.example/' },
    };
    const serialized = { url: { en: 'https://changed.example/' } };
    const ctx = context(current, serialized);
    const result = await readFormRecord(ctx, models, ['en', 'it']);
    expect(result.record.values).toEqual(current);
    expect(result.warnings).toEqual([]);
    expect(serialized).toEqual({ url: { en: 'https://changed.example/' } });
    expect(ctx.formValues.url).toBe(current.url);
    expect(rawFind).not.toHaveBeenCalled();
  });

  it('does not restore removed locales whose values remain in form state', async () => {
    const models = schema([field('url', 'string', true)]);
    const ctx = context({
      internalLocales: ['en'],
      url: { en: 'https://enabled.example/', it: 'https://removed.example/' },
    });
    const result = await readFormRecord(ctx, models, ['en', 'it']);
    expect(result.record.values).toEqual({
      url: { en: 'https://enabled.example/' },
    });
    expect(result.warnings).toEqual([]);
    expect(urls(result.record, models)).toEqual(['https://enabled.example/']);
  });

  it.each([
    ['rich_text', [currentCard], [savedCard]],
    ['single_block', currentCard, savedCard],
    [
      'structured_text',
      [
        {
          type: 'block',
          id: 'card-1',
          blockModelId: 'card',
          url: currentCard.url,
        },
      ],
      {
        schema: 'dast',
        document: {
          type: 'root',
          children: [{ type: 'block', item: savedCard }],
        },
      },
    ],
  ])('restores omitted %s after proving the saved nested value matches the form', async (type, raw, saved) => {
    const models = schema([field('content', String(type))], [card]);
    const ctx = context({ content: raw });
    rawFind.mockResolvedValue({ data: item({ content: saved }) });
    const result = await readFormRecord(ctx, models, ['en']);
    expect(result.record.values.content).toBe(saved);
    expect(result.warnings).toEqual([]);
    expect(urls(result.record, models)).toEqual(['https://card.example/']);
    expect(rawFind).toHaveBeenCalledExactlyOnceWith('page-1', {
      nested: true,
      version: 'current',
    });
    expect(buildClient).toHaveBeenCalledWith({
      apiToken: 'test-user-token',
      environment: 'main',
      baseUrl: 'https://cma.example',
    });
  });

  it('combines localized nested fallback with unsaved serialized content without overwriting it', async () => {
    const models = schema([field('content', 'rich_text', true)], [card]);
    const unsavedCard = item({ url: 'https://unsaved.example/' }, 'card');
    const ctx = context(
      {
        content: {
          en: [{ ...currentCard, url: 'https://unsaved.example/' }],
          it: [currentCard],
        },
      },
      { content: { en: [unsavedCard] } },
      {
        itemToFormValues: vi.fn().mockResolvedValue({
          content: { en: [currentCard], it: [currentCard] },
        }),
      },
    );
    rawFind.mockResolvedValue({
      data: item({ content: { en: [savedCard], it: [savedCard] } }),
    });
    const result = await readFormRecord(ctx, models, ['en', 'it']);
    expect(result.warnings).toEqual([]);
    expect(urls(result.record, models)).toEqual([
      'https://unsaved.example/',
      'https://card.example/',
    ]);
  });

  it('does not replace omitted unsaved containers with a different saved value', async () => {
    const models = schema([field('content', 'rich_text')], [card]);
    const ctx = context(
      { content: [{ ...currentCard, url: 'https://unsaved.example/' }] },
      {},
      {
        itemToFormValues: vi.fn().mockResolvedValue({ content: [currentCard] }),
      },
    );
    rawFind.mockResolvedValue({ data: item({ content: [savedCard] }) });
    const result = await readFormRecord(ctx, models, ['en']);
    expect(result.record.values.content).toBeUndefined();
    expect(result.warnings).toEqual([
      expect.stringContaining(
        'content: Current content could not be fully read',
      ),
    ]);
    expect(urls(result.record, models)).toEqual([]);
  });

  it('does not require saved reads when all containers were serialized', async () => {
    const models = schema([field('content', 'rich_text')], [card]);
    const ctx = context({ content: [currentCard] }, { content: [savedCard] });
    const result = await readFormRecord(ctx, models, ['en']);
    expect(result.warnings).toEqual([]);
    expect(rawFind).not.toHaveBeenCalled();
    expect(ctx.itemToFormValues).not.toHaveBeenCalled();
  });

  it.each([
    { item: null },
    { currentUserAccessToken: undefined },
  ])('reports incomplete containers when saved comparison is unavailable (%j)', async (overrides) => {
    const models = schema([field('content', 'rich_text')], [card]);
    const result = await readFormRecord(
      context({ content: [currentCard] }, {}, overrides),
      models,
      ['en'],
    );
    expect(result.warnings).toHaveLength(1);
    expect(rawFind).not.toHaveBeenCalled();
  });

  it('reports permission/read failures without discarding readable scalar values', async () => {
    const models = schema([field(), field('content', 'rich_text')], [card]);
    rawFind.mockRejectedValue(new Error('Permission denied'));
    const result = await readFormRecord(
      context({ url: 'https://readable.example/', content: [currentCard] }),
      models,
      ['en'],
    );
    expect(result.warnings).toHaveLength(1);
    expect(urls(result.record, models)).toEqual(['https://readable.example/']);
  });

  it('audits missing fields inside nested blocks, including inline Structured Text blocks', async () => {
    const models = schema([field('content', 'structured_text')], [card]);
    const content = {
      schema: 'dast',
      document: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [{ type: 'inlineBlock', item: item({}, 'card') }],
          },
        ],
      },
    };
    const result = await readFormRecord(context({}, { content }), models, [
      'en',
    ]);
    expect(result.warnings).toEqual([
      expect.stringContaining('content › Card › url:'),
    ]);
  });

  it('checks nested localized field coverage and preserves explicitly empty values', async () => {
    const localizedCard = { ...card, fields: [field('url', 'string', true)] };
    const models = schema([field('content', 'single_block')], [localizedCard]);
    const result = await readFormRecord(
      context({}, { content: item({ url: { en: null } }, 'card') }),
      models,
      ['en', 'it'],
    );
    expect(result.warnings).toEqual([
      expect.stringContaining('content › Card › url (it):'),
    ]);
  });

  it('accepts empty supported containers and ignores custom editors and unrelated fields', async () => {
    const models = schema([
      field('blocks', 'rich_text'),
      field('body', 'structured_text'),
      field('single', 'single_block'),
      field('custom', 'string', false, 'custom-editor'),
      field('json', 'json'),
      field('image', 'file'),
    ]);
    const result = await readFormRecord(
      context({ blocks: [], body: [], single: null }),
      models,
      ['en'],
    );
    expect(result.record.values).toEqual({
      blocks: [],
      body: null,
      single: null,
    });
    expect(result.warnings).toEqual([]);
    expect(rawFind).not.toHaveBeenCalled();
  });

  it('marks SDK loading failures incomplete without claiming saved content is current', async () => {
    const ctx = context(
      { url: 'https://form.example/' },
      {},
      { formValuesToItem: vi.fn().mockResolvedValue(undefined) },
    );
    await expect(
      readFormRecord(ctx, schema([field()]), ['en']),
    ).rejects.toThrow('still loading');
    expect(rawFind).not.toHaveBeenCalled();
  });

  it('cancels pending SDK conversion and does not start a saved read after late completion', async () => {
    const controller = new AbortController();
    const conversion = deferred<ReturnType<typeof item>>();
    const ctx = context(
      { content: [currentCard] },
      {},
      { formValuesToItem: vi.fn().mockReturnValue(conversion.promise) },
    );
    const result = readFormRecord(
      ctx,
      schema([field('content', 'rich_text')], [card]),
      ['en'],
      controller.signal,
    );
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    conversion.resolve(item({}));
    await Promise.resolve();
    expect(rawFind).not.toHaveBeenCalled();
  });

  it('cancels a pending saved read and observes its late rejection', async () => {
    const controller = new AbortController();
    const request = deferred<unknown>();
    rawFind.mockReturnValue(request.promise);
    const ctx = context({ content: [currentCard] });
    const result = readFormRecord(
      ctx,
      schema([field('content', 'rich_text')], [card]),
      ['en'],
      controller.signal,
    );
    await vi.waitFor(() => expect(rawFind).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    request.reject(new Error('Late failure'));
    await Promise.resolve();
    expect(ctx.itemToFormValues).not.toHaveBeenCalled();
  });
});
