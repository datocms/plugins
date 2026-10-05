// @vitest-environment node

import { buildClient } from '@datocms/cma-client-browser';
import { describe, expect, test, vi } from 'vitest';
import {
  type RecordReadClient,
  readRecord,
  readRecordPage,
} from './readRecords';
import { buildRecordExportEnvelope } from './recordExport';

type JsonObject = Record<string, unknown>;

function rawRecord(attributes: JsonObject = {}, id = 'record') {
  return {
    id,
    type: 'item',
    attributes,
    relationships: { item_type: { data: { type: 'item_type', id: 'page' } } },
    meta: { current_version: 'version', status: 'draft' },
  };
}

function transportClient(body: unknown) {
  const fetchFn = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
      }),
  );
  const client = buildClient({
    apiToken: null,
    baseUrl: 'https://records.invalid',
    autoRetry: false,
    fetchFn,
  });
  return { client, fetchFn };
}

function identityClient(body: unknown) {
  const request = vi.fn(
    async (_options: Parameters<RecordReadClient['request']>[0]) => body,
  );
  const client: RecordReadClient = {
    request: <T>(options: Parameters<RecordReadClient['request']>[0]) =>
      request(options) as Promise<T>,
  };
  return { client, request };
}

describe('raw record reads without recursive SDK deserialization', () => {
  test('reads a JSON type:item value that makes the real SDK list deserializer throw', async () => {
    const custom = { type: 'item', label: 'Ordinary JSON, not a block' };
    const { client, fetchFn } = transportClient({
      data: [rawRecord({ custom })],
    });

    await expect(client.items.list({ nested: true })).rejects.toBeInstanceOf(
      TypeError,
    );
    const records = await readRecordPage(client, {
      filter: { type: 'page' },
      page: { limit: 30, offset: 60 },
      order_by: 'id_ASC',
    });

    expect(records[0].custom).toEqual(custom);
    expect(records[0]).toMatchObject({
      id: 'record',
      type: 'item',
      __itemTypeId: 'page',
    });
    const url = new URL(String(fetchFn.mock.calls[1][0]));
    expect(url.pathname).toBe('/items');
    expect(url.searchParams.get('nested')).toBe('true');
    expect(url.searchParams.get('page[limit]')).toBe('30');
    expect(url.searchParams.get('page[offset]')).toBe('60');
    expect(url.searchParams.get('filter[type]')).toBe('page');
    expect(fetchFn.mock.calls[1][1]?.method).toBe('GET');
  });

  test('reads a JSON type:item value that makes the real SDK find deserializer throw', async () => {
    const custom = { type: 'item', label: 'Another ordinary JSON object' };
    const { client } = transportClient({ data: rawRecord({ custom }) });

    await expect(
      client.items.find('record', { nested: true }),
    ).rejects.toBeInstanceOf(TypeError);

    expect((await readRecord(client, 'record')).custom).toEqual(custom);
  });

  test('preserves a complete CMA-shaped object inside a JSON field without injecting SDK properties', async () => {
    const custom = rawRecord(
      { title: 'This object belongs to a JSON field' },
      'json-value',
    );
    const { client } = transportClient({ data: [rawRecord({ custom })] });
    const sdkRecords = await client.items.list({ nested: true });
    expect(sdkRecords[0]).toMatchObject({ custom: { __itemTypeId: 'page' } });

    const records = await readRecordPage(client, {});

    expect(records[0].custom).toEqual(custom);
    expect(Object.hasOwn(records[0].custom as JsonObject, '__itemTypeId')).toBe(
      false,
    );
  });

  test('preserves nested raw blocks while exporting their record and upload references', async () => {
    const child = {
      ...rawRecord({ asset: { upload_id: 'upload' } }, 'child'),
      relationships: {
        item_type: { data: { type: 'item_type', id: 'block' } },
      },
    };
    const parent = {
      ...rawRecord({ target: 'linked-record', nested: child }, 'parent'),
      relationships: {
        item_type: { data: { type: 'item_type', id: 'block' } },
      },
    };
    const body = { en: [parent], pt: ['external-block'] };
    const { client } = identityClient({ data: [rawRecord({ body })] });
    const records = await readRecordPage(client, {});
    const envelope = buildRecordExportEnvelope({
      records,
      itemTypes: [
        { id: 'page', api_key: 'page' },
        { id: 'block', api_key: 'block' },
      ],
      fields: [
        {
          id: 'body',
          item_type: { id: 'page' },
          api_key: 'body',
          field_type: 'rich_text',
          localized: true,
        },
        {
          id: 'target',
          item_type: { id: 'block' },
          api_key: 'target',
          field_type: 'link',
        },
        {
          id: 'nested',
          item_type: { id: 'block' },
          api_key: 'nested',
          field_type: 'single_block',
        },
        {
          id: 'asset',
          item_type: { id: 'block' },
          api_key: 'asset',
          field_type: 'file',
        },
      ],
      siteInfo: {
        sourceProjectId: 'project',
        sourceEnvironment: 'main',
        defaultLocale: 'en',
        locales: ['en', 'pt'],
      },
      filtersUsed: {},
      scope: 'bulk',
    });

    expect(records[0].body).toBe(body);
    expect(envelope.records[0].body).toBe(body);
    expect(Object.hasOwn(parent, '__itemTypeId')).toBe(false);
    expect(Object.hasOwn(child, '__itemTypeId')).toBe(false);
    expect(envelope.referenceIndex.recordRefs).toContainEqual(
      expect.objectContaining({
        targetSourceId: 'linked-record',
        sourceBlockId: 'parent',
        locale: 'en',
        jsonPath: '$.records[0].body.en[0].attributes.target',
      }),
    );
    expect(envelope.referenceIndex.uploadRefs).toContainEqual(
      expect.objectContaining({
        targetSourceId: 'upload',
        sourceBlockId: 'child',
        locale: 'en',
        jsonPath: '$.records[0].body.en[0].attributes.nested.attributes.asset',
      }),
    );
    expect(envelope.referenceIndex.blockRefs).toContainEqual(
      expect.objectContaining({
        blockSourceId: 'child',
        blockModelId: 'block',
        parentBlockSourceId: 'parent',
      }),
    );
  });

  test('matches the SDK root shape for attributes, relationships and metadata', async () => {
    const raw = {
      ...rawRecord({ title: 'Page', locales: { en: 'Hello', pt: 'Olá' } }),
      relationships: {
        item_type: { data: { type: 'item_type', id: 'page' } },
        creator: { data: { type: 'account', id: 'author' } },
        stage: { data: null },
        related: { data: [{ type: 'item', id: 'other' }] },
      },
    };
    const { client } = transportClient({ data: [raw] });

    expect(await readRecordPage(client, {})).toEqual(
      await client.items.list({ nested: true }),
    );
    const { client: fake } = identityClient({ data: [raw] });
    const [record] = await readRecordPage(fake, {});
    expect(record.meta).toBe(raw.meta);
    expect(record.item_type).toBe(raw.relationships.item_type.data);
    expect(record.creator).toBe(raw.relationships.creator.data);
    expect(record.related).toBe(raw.relationships.related.data);
    expect(record.stage).toBeNull();
  });

  test('encodes single record IDs and requests nested content explicitly', async () => {
    const id = 'record/with?query#hash';
    const { client, request } = identityClient({ data: rawRecord({}, id) });

    expect((await readRecord(client, id)).id).toBe(id);
    expect(request).toHaveBeenCalledWith({
      method: 'GET',
      url: `/items/${encodeURIComponent(id)}`,
      queryParams: { nested: true },
    });
  });

  test('requests nested pages without mutating caller query parameters', async () => {
    const { client, request } = identityClient({ data: [] });
    const query = {
      nested: false,
      page: { limit: 15, offset: 30 },
      filter: { type: 'page' },
    };

    expect(await readRecordPage(client, query)).toEqual([]);
    expect(request).toHaveBeenCalledWith({
      method: 'GET',
      url: '/items',
      queryParams: { ...query, nested: true },
    });
    expect(query.nested).toBe(false);
  });
});

describe('raw record response guards', () => {
  test.each([null, [], {}, { data: null }, { data: {} }, { data: 'items' }])(
    'rejects invalid page body %j',
    async (body) => {
      await expect(
        readRecordPage(identityClient(body).client, {}),
      ).rejects.toThrow('invalid record response');
    },
  );

  test.each([null, [], {}, { data: null }, { data: [] }, { data: 'item' }])(
    'rejects invalid single record body %j',
    async (body) => {
      await expect(
        readRecord(identityClient(body).client, 'record'),
      ).rejects.toThrow('invalid record response');
    },
  );

  test.each([
    { id: '' },
    { id: 42 },
    { type: 'upload' },
    { attributes: null },
    { attributes: [] },
    { relationships: null },
    { relationships: [] },
    { relationships: {} },
    { relationships: { item_type: { data: { id: '' } } } },
    { relationships: { item_type: { data: null } } },
    { relationships: { item_type: { data: { id: 'page' } }, creator: {} } },
    {
      relationships: {
        item_type: { data: { id: 'page' } },
        creator: { data: 'author' },
      },
    },
    { meta: [] },
  ])('rejects invalid top-level record fragment %j', async (fragment) => {
    const record = { ...rawRecord(), ...fragment };
    await expect(
      readRecordPage(identityClient({ data: [record] }).client, {}),
    ).rejects.toThrow('invalid record response');
    await expect(
      readRecord(identityClient({ data: record }).client, 'record'),
    ).rejects.toThrow('invalid record response');
  });

  test.each(['', '   '])(
    'rejects empty single record ID %j before requesting',
    async (id) => {
      const { client, request } = identityClient({ data: rawRecord() });
      await expect(readRecord(client, id)).rejects.toThrow(
        'record ID is required',
      );
      expect(request).not.toHaveBeenCalled();
    },
  );
});
