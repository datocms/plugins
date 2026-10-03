import type { Field, ItemType, Role } from 'datocms-plugin-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSchemaLoader } from './schema';

function model(id: string, isBlock = false): ItemType {
  return {
    id,
    type: 'item_type',
    attributes: { name: id, modular_block: isBlock },
    relationships: {
      presentation_title_field: { data: { id: 'title', type: 'field' } },
      workflow: { data: null },
    },
  } as unknown as ItemType;
}

function field(id: string, validators: Record<string, unknown> = {}): Field {
  return {
    id,
    type: 'field',
    attributes: {
      api_key: id,
      label: id,
      field_type: 'structured_text',
      localized: true,
      appearance: { editor: 'structured_text' },
      validators,
    },
  } as unknown as Field;
}

afterEach(() => vi.useRealTimers());

describe('createSchemaLoader', () => {
  it('cancels schema retry backoff without launching another host request', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const loadItemTypeFields = vi
      .fn()
      .mockRejectedValue(new TypeError('Transient host failure'));
    const loader = createSchemaLoader({
      itemTypes: { article: model('article') },
      loadItemTypeFields,
    });
    const pending = loader.load('article', controller.signal);
    const result = expect(pending).rejects.toMatchObject({
      name: 'AbortError',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(loadItemTypeFields).toHaveBeenCalledOnce();
    controller.abort();
    await vi.runAllTimersAsync();
    await result;
    expect(loadItemTypeFields).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('observes a late transient SDK failure after cancellation without retrying it', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let rejectLate: ((error: Error) => void) | undefined;
    const loadItemTypeFields = vi.fn(
      () =>
        new Promise<Field[]>((_resolve, reject) => {
          rejectLate = reject;
        }),
    );
    const loader = createSchemaLoader({
      itemTypes: { article: model('article') },
      loadItemTypeFields,
    });
    const pending = loader.load('article', controller.signal);
    const result = expect(pending).rejects.toMatchObject({
      name: 'AbortError',
    });
    controller.abort();
    await result;
    rejectLate?.(new TypeError('Late transient SDK failure'));
    await vi.runAllTimersAsync();
    expect(loadItemTypeFields).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves a late successful SDK result in the shared cache after cancellation', async () => {
    const controller = new AbortController();
    let resolveLate: ((fields: Field[]) => void) | undefined;
    const loadItemTypeFields = vi.fn(
      () =>
        new Promise<Field[]>((resolve) => {
          resolveLate = resolve;
        }),
    );
    const loader = createSchemaLoader({
      itemTypes: { article: model('article') },
      loadItemTypeFields,
    });
    const cancelled = loader.load('article', controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    resolveLate?.([field('body')]);
    const schema = await loader.load('article');
    expect(schema.get('article')?.fields[0].apiKey).toBe('body');
    expect(loadItemTypeFields).toHaveBeenCalledOnce();
  });

  it('keeps a concurrent active schema consumer running when the first is cancelled', async () => {
    const controller = new AbortController();
    let resolveLate: ((fields: Field[]) => void) | undefined;
    const loadItemTypeFields = vi.fn(
      () =>
        new Promise<Field[]>((resolve) => {
          resolveLate = resolve;
        }),
    );
    const loader = createSchemaLoader({
      itemTypes: { article: model('article') },
      loadItemTypeFields,
    });
    const cancelled = loader.load('article', controller.signal);
    const active = loader.load('article');
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    resolveLate?.([]);
    expect((await active).get('article')?.fields).toEqual([]);
    expect(loadItemTypeFields).toHaveBeenCalledOnce();
  });

  it('keeps readable fields when an optional nested schema fails and reports the gap', async () => {
    const warn = vi.fn();
    const loader = createSchemaLoader({
      itemTypes: { article: model('article'), hero: model('hero', true) },
      loadItemTypeFields: vi.fn(async (id: string) => {
        if (id === 'hero') throw new Error('Permission denied');
        return [
          field('body', {
            structured_text_blocks: { item_types: ['hero', 'missing'] },
          }),
        ];
      }),
    });
    const schema = await loader.load('article', undefined, warn);
    expect([...schema.keys()]).toEqual(['article']);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('cancels a pending host field request immediately and observes a late rejection', async () => {
    const controller = new AbortController();
    let rejectLate: ((error: Error) => void) | undefined;
    const loadItemTypeFields = vi.fn(
      () =>
        new Promise<Field[]>((_resolve, reject) => {
          rejectLate = reject;
        }),
    );
    const loader = createSchemaLoader({
      itemTypes: { article: model('article') },
      loadItemTypeFields,
    });
    const pending = loader.load('article', controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    rejectLate?.(new Error('Late host failure'));
    await Promise.resolve();
    expect(loadItemTypeFields).toHaveBeenCalledOnce();
  });

  it('loads a wide cyclic graph once per model with bounded sequential host requests', async () => {
    const blockIds = Array.from(
      { length: 500 },
      (_, index) => `block-${index}`,
    );
    const itemTypes = Object.fromEntries([
      ['article', model('article')],
      ...blockIds.map((id) => [id, model(id, true)]),
    ]);
    let active = 0;
    let peak = 0;
    const loadItemTypeFields = vi.fn(async (id: string) => {
      active += 1;
      peak = Math.max(active, peak);
      await Promise.resolve();
      active -= 1;
      return [
        field('body', {
          structured_text_blocks: {
            item_types: id === 'article' ? blockIds : ['block-0'],
          },
        }),
      ];
    });
    const schema = await createSchemaLoader({
      itemTypes,
      loadItemTypeFields,
    }).load('article');
    expect(schema.size).toBe(501);
    expect(loadItemTypeFields).toHaveBeenCalledTimes(501);
    expect(peak).toBe(1);
  });
  it('discovers regular models and loads recursive/inline blocks with cycle-safe caching', async () => {
    const itemTypes = {
      article: model('article'),
      hero: model('hero', true),
      button: model('button', true),
      empty: undefined,
    };
    const loadItemTypeFields = vi.fn(async (id: string) => {
      if (id === 'article')
        return [
          field('body', {
            structured_text_blocks: { item_types: ['hero'] },
            structured_text_inline_blocks: { item_types: ['button'] },
          }),
        ];
      if (id === 'hero')
        return [
          field('nested', { single_block_blocks: { item_types: ['button'] } }),
        ];
      return [field('nested', { rich_text_blocks: { item_types: ['hero'] } })];
    });
    const loader = createSchemaLoader({ itemTypes, loadItemTypeFields });
    expect(loader.models.map((entry) => entry.id)).toEqual(['article']);
    const [schema, repeated] = await Promise.all([
      loader.load('article'),
      loader.load('article'),
    ]);
    expect([...schema.keys()]).toEqual(['article', 'hero', 'button']);
    expect(repeated).toEqual(schema);
    expect(schema.get('article')?.fields[0]).toEqual({
      id: 'body',
      apiKey: 'body',
      label: 'body',
      type: 'structured_text',
      localized: true,
      editor: 'structured_text',
    });
    expect(loadItemTypeFields).toHaveBeenCalledTimes(3);
  });

  it('fails if an allowed nested model is not available', async () => {
    const loader = createSchemaLoader({
      itemTypes: { article: model('article') },
      loadItemTypeFields: vi.fn().mockResolvedValue([
        field('body', {
          structured_text_blocks: { item_types: ['missing'] },
        }),
      ]),
    });
    await expect(loader.load('article')).rejects.toThrow(
      'schema for model missing',
    );
  });

  it('surfaces failed schema requests and retries them on the next scan', async () => {
    const loadItemTypeFields = vi
      .fn()
      .mockRejectedValueOnce(new Error('No access'))
      .mockResolvedValueOnce([]);
    const loader = createSchemaLoader({
      itemTypes: { article: model('article') },
      loadItemTypeFields,
    });
    await expect(loader.load('article')).rejects.toThrow('No access');
    expect((await loader.load('article')).get('article')?.fields).toEqual([]);
    expect(loadItemTypeFields).toHaveBeenCalledTimes(2);
  });

  it('accepts read-only grants and leaves creator-scoped restrictions to CMA', () => {
    const currentRole = {
      attributes: {
        positive_item_type_permissions: [
          {
            action: 'read',
            environment: 'sandbox',
            item_type: null,
            on_creator: 'self',
          },
        ],
        negative_item_type_permissions: [
          {
            action: 'read',
            environment: 'sandbox',
            item_type: 'denied',
            on_creator: 'anyone',
          },
          {
            action: 'read',
            environment: 'sandbox',
            item_type: 'restricted',
            on_creator: 'self',
          },
        ],
      },
    } as unknown as Role;
    const loader = createSchemaLoader({
      itemTypes: {
        article: model('article'),
        denied: model('denied'),
        restricted: model('restricted'),
      },
      loadItemTypeFields: vi.fn(),
      environment: 'sandbox',
      currentRole,
    });
    expect(loader.models.map((entry) => entry.id)).toEqual([
      'article',
      'restricted',
    ]);
  });

  it('does not expose models with only an edit grant or grants in another environment', () => {
    const currentRole = {
      attributes: {
        positive_item_type_permissions: [
          { action: 'update', environment: 'sandbox', item_type: 'article' },
          { action: 'read', environment: 'main', item_type: 'article' },
        ],
        negative_item_type_permissions: [],
      },
    } as unknown as Role;
    expect(
      createSchemaLoader({
        itemTypes: { article: model('article') },
        loadItemTypeFields: vi.fn(),
        environment: 'sandbox',
        currentRole,
      }).models,
    ).toEqual([]);
  });

  it('includes models readable through inherited role permissions', () => {
    const currentRole = {
      attributes: {
        positive_item_type_permissions: [],
        negative_item_type_permissions: [],
      },
      meta: {
        final_permissions: {
          positive_item_type_permissions: [
            {
              action: 'read',
              environment: 'sandbox',
              item_type: null,
              on_creator: 'anyone',
            },
          ],
          negative_item_type_permissions: [],
        },
      },
    } as unknown as Role;
    expect(
      createSchemaLoader({
        itemTypes: { article: model('article') },
        loadItemTypeFields: vi.fn(),
        environment: 'sandbox',
        currentRole,
      }).models.map((entry) => entry.id),
    ).toEqual(['article']);
  });
});
