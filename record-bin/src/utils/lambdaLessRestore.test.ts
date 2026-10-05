import { buildClient } from '@datocms/cma-client-browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isLambdaLessRestoreError,
  restoreRecordWithoutLambda,
} from './lambdaLessRestore';
import { buildRecordBinCompatiblePayload } from './recordBinPayload';
import { prepareRecordBinBody } from './recordBinStorage';

vi.mock('@datocms/cma-client-browser', () => ({ buildClient: vi.fn() }));
type Entity = Record<string, unknown>;
const SOURCE_ID = 'hWl-mnkWRYmMCSTq4z_piQ';
const ARCHIVE_ID = 'archive-id';
const field = (api_key: string, field_type = 'string', localized = false) => ({
  api_key,
  field_type,
  localized,
});
const entity = (
  id = SOURCE_ID,
  attributes: Record<string, unknown> = { title: 'Archived title' },
  modelId = 'article',
): Entity => ({
  id,
  type: 'item',
  attributes,
  relationships: { item_type: { data: { type: 'item_type', id: modelId } } },
  meta: {
    created_at: '2024-01-01T00:00:00.000Z',
    first_published_at: null,
    status: 'published',
  },
});

const createClientMock = () => {
  const stored = new Map<string, Entity>([
    [ARCHIVE_ID, entity(ARCHIVE_ID, { record_body: 'archived' }, 'record-bin')],
  ]);
  const schemas = new Map([
    [
      'article',
      [
        field('title'),
        field('content', 'rich_text'),
        field('single', 'single_block'),
        field('story', 'structured_text'),
        field('localized', 'rich_text', true),
      ],
    ],
    ['block-model', [field('text'), field('nested', 'single_block')]],
  ]);
  const create = vi.fn(async (input: { data: Entity }) => {
    const created = {
      id: 'server-assigned-id',
      ...structuredClone(input.data),
    };
    if (stored.has(String(created.id))) throw { response: { status: 422 } };
    stored.set(String(created.id), created);
    return { data: structuredClone(created) };
  });
  const find = vi.fn(async (id: string) => {
    const record = stored.get(id);
    if (!record) throw { response: { status: 404 } };
    return { data: structuredClone(record) };
  });
  const request = vi.fn(
    async (input: { method: string; url: string; body?: unknown }) => {
      if (input.method === 'POST')
        return create(input.body as { data: Entity });
      return find(decodeURIComponent(input.url.slice('/items/'.length)));
    },
  );
  const destroy = vi.fn(async (id: string) => {
    stored.delete(id);
    return {};
  });
  const list = vi.fn(async (id: string) => {
    const fields = schemas.get(id);
    if (!fields) throw { response: { status: 404 } };
    return fields;
  });
  const client = { request, items: { destroy }, fields: { list } };
  vi.mocked(buildClient).mockReturnValue(
    client as unknown as ReturnType<typeof buildClient>,
  );
  return { client, stored, schemas, create, find, destroy, list, request };
};
const restore = (
  recordBody: unknown,
  options: Partial<Parameters<typeof restoreRecordWithoutLambda>[0]> = {},
) =>
  restoreRecordWithoutLambda({
    currentUserAccessToken: 'token',
    currentEnvironment: 'main',
    recordBody,
    trashRecordID: ARCHIVE_ID,
    ...options,
  });

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('restoreRecordWithoutLambda', () => {
  it('preserves the source ID, supported timestamps and original payload, then removes its archive', async () => {
    const mock = createClientMock();
    const record = entity();
    (record.relationships as Record<string, unknown>).creator = {
      data: { type: 'user', id: 'user-id' },
    };
    const original = structuredClone(record);
    const result = await restore({
      event_type: 'to_be_restored',
      environment: 'main',
      entity: record,
    });

    expect(result).toEqual({
      restoredRecord: { id: SOURCE_ID, modelID: 'article' },
    });
    expect(mock.create.mock.calls[0][0].data).toMatchObject({
      id: SOURCE_ID,
      meta: {
        created_at: '2024-01-01T00:00:00.000Z',
        first_published_at: null,
      },
    });
    expect(
      (
        mock.create.mock.calls[0][0].data.relationships as Record<
          string,
          unknown
        >
      ).creator,
    ).toBeUndefined();
    expect(record).toEqual(original);
    expect(mock.destroy).toHaveBeenCalledWith(ARCHIVE_ID);
    expect(buildClient).toHaveBeenCalledWith({
      apiToken: 'token',
      environment: 'main',
    });
  });

  it('supports raw entities, legacy numeric IDs and the current UI environment/base URL', async () => {
    const mock = createClientMock();
    const record = entity('123');
    const result = await restore(record, {
      currentEnvironment: 'sandbox',
      cmaBaseUrl: 'https://site-api.example.test',
    });
    expect(mock.create.mock.calls[0][0].data.id).toBeUndefined();
    expect(result.restoredRecord.id).toBe('server-assigned-id');
    expect(buildClient).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: 'sandbox',
        baseUrl: 'https://site-api.example.test',
      }),
    );
  });

  it('sanitizes nested localized blocks and DAST embeds while preserving links, JSON and asset metadata', async () => {
    const mock = createClientMock();
    const block = entity(
      'block-id',
      {
        text: 'Nested block',
        arbitrary: {
          id: 'json-id',
          type: 'item',
          attributes: { id: 'opaque' },
          relationships: { item_type: { data: { id: 'json-model' } } },
          __itemTypeId: 'literal-json-key',
        },
        asset: {
          upload_id: 'upload-id',
          custom_data: { id: 'asset-metadata-id' },
        },
        nested: entity('nested-block-id', { text: 'Child' }, 'block-model'),
      },
      'block-model',
    );
    const record = entity(SOURCE_ID, {
      title: 'Complex',
      content: [block],
      single: entity('single-id', { text: 'Single' }, 'block-model'),
      localized: {
        'pt-BR': [entity('localized-id', { text: 'Olá' }, 'block-model')],
        en: [],
      },
      story: {
        schema: 'dast',
        document: {
          type: 'root',
          children: [
            {
              type: 'block',
              item: entity('dast-block', { text: 'Block' }, 'block-model'),
            },
            {
              type: 'paragraph',
              children: [
                {
                  type: 'inlineBlock',
                  item: entity(
                    'inline-block',
                    { text: 'Inline' },
                    'block-model',
                  ),
                },
                {
                  type: 'itemLink',
                  item: SOURCE_ID,
                  meta: [{ id: 'target', value: '_blank' }],
                  children: [
                    { type: 'span', value: 'Link', marks: ['strong'] },
                  ],
                },
                { type: 'inlineItem', item: 'linked-record-id' },
              ],
            },
          ],
        },
      },
      linked_records: ['record-1', 'record-2'],
      json: { id: 'top-level-json-id', nested: { id: 'another-json-id' } },
    });
    const original = structuredClone(record);
    await restore(record);
    const data = mock.create.mock.calls[0][0].data;
    const attributes = data.attributes as Record<string, unknown>;
    const content = attributes.content as Entity[];
    expect(content[0].id).toBeUndefined();
    expect(content[0].meta).toBeUndefined();
    expect(
      (content[0].attributes as Record<string, unknown>).nested,
    ).toMatchObject({ type: 'item', attributes: { text: 'Child' } });
    expect(
      ((content[0].attributes as Record<string, unknown>).nested as Entity).id,
    ).toBeUndefined();
    expect(
      (content[0].attributes as Record<string, unknown>).arbitrary,
    ).toEqual((block.attributes as Record<string, unknown>).arbitrary);
    expect((content[0].attributes as Record<string, unknown>).asset).toEqual(
      (block.attributes as Record<string, unknown>).asset,
    );
    expect(attributes.json).toEqual(
      (record.attributes as Record<string, unknown>).json,
    );
    expect(attributes.linked_records).toEqual(
      (record.attributes as Record<string, unknown>).linked_records,
    );
    const story = attributes.story as {
      document: {
        children: {
          type: string;
          item?: Entity;
          children?: { type: string; item: unknown; meta?: unknown }[];
        }[];
      };
    };
    expect(story.document.children[0].item?.id).toBeUndefined();
    const nodes = story.document.children[1].children;
    const inlineBlock = nodes?.[0].item as Entity | undefined;
    expect(inlineBlock).toBeDefined();
    expect(inlineBlock?.id).toBeUndefined();
    expect(nodes?.[1].item).toBe(SOURCE_ID);
    expect(nodes?.[1].meta).toEqual([{ id: 'target', value: '_blank' }]);
    expect(nodes?.[2].item).toBe('linked-record-id');
    expect(record).toEqual(original);
    expect(mock.list).toHaveBeenCalledTimes(2);
  });

  it('preserves legitimate timestamp-named fields and deletes historical extraneous attributes', async () => {
    const mock = createClientMock();
    mock.schemas.get('article')?.push(field('created_at'));
    await restore(
      entity(SOURCE_ID, {
        title: 'Title',
        created_at: 'editor value',
        updated_at: 'old API timestamp',
      }),
    );
    expect(mock.create.mock.calls[0][0].data.attributes).toEqual({
      title: 'Title',
      created_at: 'editor value',
    });
  });

  it('rejects incomplete block IDs and preserves the archive', async () => {
    const mock = createClientMock();
    await expect(
      restore(entity(SOURCE_ID, { content: ['deleted-block-id'] })),
    ).rejects.toThrow('The record could not be restored!');
    expect(mock.create).not.toHaveBeenCalled();
    expect(mock.destroy).not.toHaveBeenCalled();
  });

  it('reports successful creation separately from a failed archive cleanup', async () => {
    const mock = createClientMock();
    mock.destroy.mockRejectedValueOnce({ response: { status: 403 } });
    const result = await restore(entity());
    expect(result.restoredRecord.id).toBe(SOURCE_ID);
    expect(result.cleanupError).toBeDefined();
    expect(mock.stored.has(ARCHIVE_ID)).toBe(true);
  });

  it('preserves structured API validation errors and never removes a failed restoration archive', async () => {
    const mock = createClientMock();
    mock.create.mockRejectedValue({
      errors: [
        {
          attributes: {
            code: 'VALIDATION_INVALID',
            details: { code: 'INVALID_FIELD', field: 'title' },
          },
        },
      ],
    });
    await expect(restore(entity())).rejects.toSatisfy((error: unknown) => {
      if (!isLambdaLessRestoreError(error)) return false;
      expect(error.restorationError.simplifiedError.code).toBe(
        'VALIDATION_INVALID',
      );
      expect(error.restorationError.fullErrorPayload).toContain(
        'VALIDATION_INVALID',
      );
      return true;
    });
    expect(mock.create).toHaveBeenCalledTimes(1);
    expect(mock.destroy).not.toHaveBeenCalled();
  });

  it('restores a packed archive without introducing an external storage request', async () => {
    const mock = createClientMock();
    const body = await prepareRecordBinBody({
      payload: buildRecordBinCompatiblePayload({
        environment: 'main',
        entity: entity(SOURCE_ID, {
          title: 'Large record',
          body: 'a'.repeat(300_000),
        }),
      }),
      sourceItemId: SOURCE_ID,
      environment: 'main',
      inlineRequestBytes: (recordBody) =>
        new TextEncoder().encode(recordBody).length,
    });
    expect(body).toContain('gzip/base64');
    const result = await restore(body);
    expect(result.restoredRecord.id).toBe(SOURCE_ID);
    expect(
      (mock.create.mock.calls[0][0].data.attributes as Record<string, unknown>)
        .body,
    ).toBe('a'.repeat(300_000));
  });
});
