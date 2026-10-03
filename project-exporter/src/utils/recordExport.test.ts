// @vitest-environment node
/// <reference types="vitest" />

import {
  appendScheduledActions,
  buildRecordExportEnvelope,
  fetchProjectConfigurationExport,
  ReferenceIndexLimitError,
  type SiteManifestInfo,
} from './recordExport';

const siteInfo: SiteManifestInfo = {
  sourceProjectId: 'project-1',
  sourceEnvironment: 'main',
  defaultLocale: 'en',
  locales: ['en', 'pt'],
};

describe('recordExport envelope', () => {
  const buildEnvelope = (
    records: Record<string, unknown>[],
    fields: Record<string, unknown>[],
    maxReferenceEntries?: number,
    maxReferenceBytes?: number,
  ) =>
    buildRecordExportEnvelope({
      records,
      itemTypes: [
        { id: 'page', api_key: 'page' },
        { id: 'block', api_key: 'block' },
      ],
      fields,
      siteInfo,
      filtersUsed: {},
      scope: 'bulk',
      maxReferenceEntries,
      maxReferenceBytes,
    });

  test('preserves localized arbitrary JSON without inferring references from item, upload or DAST lookalikes', () => {
    const fields = [
      {
        id: 'json',
        item_type: { id: 'page' },
        api_key: 'payload',
        field_type: 'json',
        localized: true,
      },
      {
        id: 'link',
        item_type: { id: 'page' },
        api_key: 'related',
        field_type: 'link',
      },
      {
        id: 'block-link',
        item_type: { id: 'block' },
        api_key: 'target',
        field_type: 'link',
      },
      {
        id: 'block-file',
        item_type: { id: 'block' },
        api_key: 'asset',
        field_type: 'file',
      },
      {
        id: 'block-content',
        item_type: { id: 'block' },
        api_key: 'content',
        field_type: 'structured_text',
      },
    ];
    const dastLookalike = {
      schema: 'dast',
      links: ['json-link'],
      blocks: ['json-block'],
      document: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'itemLink', item: 'json-item-link' },
              { type: 'inlineItem', item: 'json-inline-item' },
              { type: 'inlineBlock', item: 'json-inline-block' },
            ],
          },
        ],
      },
    };
    const rawCmaLookalike = {
      id: 'json-cma-item',
      type: 'item',
      meta: { current_version: 'json-version' },
      relationships: {
        item_type: { data: { type: 'item_type', id: 'block' } },
      },
      attributes: {
        target: 'json-cma-link',
        asset: { upload_id: 'json-cma-upload' },
        content: dastLookalike,
      },
    };
    const records = [
      {
        id: 'record',
        item_type: { id: 'page' },
        related: 'real-neighbor',
        payload: {
          en: {
            entities: [
              { type: 'item', id: 'json-item' },
              { type: 'upload', id: 'json-upload' },
              {
                id: 'json-sdk-block',
                item_type: { id: 'block' },
                target: 'json-sdk-link',
                asset: { upload_id: 'json-sdk-upload' },
              },
            ],
            cma: rawCmaLookalike,
            document: dastLookalike,
          },
          pt: {
            nested: [rawCmaLookalike, { type: 'upload', id: 'json-pt-upload' }],
          },
        },
      },
    ];
    const original = JSON.stringify(records);
    const withoutNeighbor = buildEnvelope(
      [{ ...records[0], related: null }],
      fields,
    );
    expect(withoutNeighbor.referenceIndex).toEqual({
      recordRefs: [],
      uploadRefs: [],
      blockRefs: [],
      structuredTextRefs: [],
    });

    const envelope = buildEnvelope(records, fields);
    expect(envelope.records).toBe(records);
    expect(JSON.stringify(envelope.records)).toBe(original);
    expect(envelope.referenceIndex.recordRefs).toEqual([
      {
        recordSourceId: 'record',
        sourceBlockId: null,
        fieldApiKey: 'related',
        locale: null,
        jsonPath: '$.records[0].related',
        targetSourceId: 'real-neighbor',
        kind: 'link',
      },
    ]);
    expect(envelope.referenceIndex.uploadRefs).toEqual([]);
    expect(envelope.referenceIndex.blockRefs).toEqual([]);
    expect(envelope.referenceIndex.structuredTextRefs).toEqual([]);
  });

  test('limits entries across all reference lists before materializing a wide block collection', () => {
    const fields = [
      {
        id: 'body',
        item_type: { id: 'page' },
        api_key: 'body',
        field_type: 'rich_text',
      },
    ];
    let reads = 0;
    const blocks = new Proxy(
      Array.from({ length: 10_000 }, () => 'block-id'),
      {
        get(target, property, receiver) {
          if (typeof property === 'string' && /^\d+$/.test(property)) reads++;
          return Reflect.get(target, property, receiver);
        },
      },
    );
    expect(() =>
      buildEnvelope(
        [{ id: 'record', item_type: { id: 'page' }, body: blocks }],
        fields,
        3,
      ),
    ).toThrow(ReferenceIndexLimitError);
    expect(reads).toBe(4);

    const mixedFields = [
      {
        id: 'related',
        item_type: { id: 'page' },
        api_key: 'related',
        field_type: 'link',
      },
      {
        id: 'asset',
        item_type: { id: 'page' },
        api_key: 'asset',
        field_type: 'file',
      },
    ];
    const mixedRecords = [
      {
        id: 'record',
        item_type: { id: 'page' },
        related: 'target',
        asset: 'upload',
      },
    ];
    expect(() => buildEnvelope(mixedRecords, mixedFields, 1)).toThrow(
      ReferenceIndexLimitError,
    );
    const result = buildEnvelope(mixedRecords, mixedFields, 2);
    expect(result.referenceIndex.recordRefs).toHaveLength(1);
    expect(result.referenceIndex.uploadRefs).toHaveLength(1);
  });

  test('budgets long paths cumulatively before reaching the reference count limit', () => {
    let reads = 0;
    const targets = new Proxy(
      Array.from({ length: 100 }, (_, index) => ({
        type: 'item',
        id: `target-${index}`,
      })),
      {
        get(target, property, receiver) {
          if (typeof property === 'string' && /^\d+$/.test(property)) reads++;
          return Reflect.get(target, property, receiver);
        },
      },
    );
    let nested: Record<string, unknown> = { targets };
    for (let index = 0; index < 25; index++) nested = { child: nested };
    let error: unknown;
    try {
      buildEnvelope(
        [{ id: 'record', item_type: { id: 'page' }, custom: nested }],
        [],
        1000,
        2500,
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ReferenceIndexLimitError);
    expect(error).toMatchObject({ unit: 'bytes', limit: 2500 });
    expect(reads).toBeGreaterThan(1);
    expect(reads).toBeLessThan(100);
  });

  test('indexes actual CMA raw nested blocks and inline blocks without rewriting the payload', () => {
    const fields = [
      {
        id: 'body',
        item_type: { id: 'page' },
        api_key: 'body',
        field_type: 'rich_text',
        localized: true,
      },
      {
        id: 'single',
        item_type: { id: 'page' },
        api_key: 'single',
        field_type: 'single_block',
      },
      {
        id: 'content',
        item_type: { id: 'page' },
        api_key: 'content',
        field_type: 'structured_text',
      },
      {
        id: 'target',
        item_type: { id: 'block' },
        api_key: 'target',
        field_type: 'link',
      },
      {
        id: 'asset',
        item_type: { id: 'block' },
        api_key: 'asset',
        field_type: 'file',
      },
      {
        id: 'nested',
        item_type: { id: 'block' },
        api_key: 'nested',
        field_type: 'single_block',
      },
    ];
    const rawBlock = (id: string, attributes: Record<string, unknown>) => ({
      id,
      type: 'item',
      relationships: {
        item_type: { data: { type: 'item_type', id: 'block' } },
      },
      attributes,
    });
    const records = [
      {
        id: 'record',
        item_type: { id: 'page' },
        body: {
          en: [
            rawBlock('parent', {
              target: 'outside-this-part',
              nested: rawBlock('child', { asset: { upload_id: 'upload' } }),
            }),
          ],
          pt: ['regular-block-id'],
        },
        single: 'single-block-id',
        content: {
          schema: 'dast',
          document: {
            type: 'root',
            children: [
              {
                type: 'paragraph',
                children: [
                  {
                    type: 'inlineBlock',
                    item: rawBlock('inline', { target: 'linked-inline' }),
                  },
                ],
              },
            ],
          },
        },
      },
    ];
    const original = JSON.stringify(records);
    const envelope = buildEnvelope(records, fields);

    expect(JSON.stringify(envelope.records)).toBe(original);
    expect(envelope.referenceIndex.recordRefs).toContainEqual(
      expect.objectContaining({
        recordSourceId: 'record',
        sourceBlockId: 'parent',
        locale: 'en',
        targetSourceId: 'outside-this-part',
        jsonPath: '$.records[0].body.en[0].attributes.target',
      }),
    );
    expect(envelope.referenceIndex.uploadRefs).toContainEqual(
      expect.objectContaining({
        sourceBlockId: 'child',
        locale: 'en',
        targetSourceId: 'upload',
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
    expect(envelope.referenceIndex.blockRefs).toContainEqual(
      expect.objectContaining({
        blockSourceId: 'single-block-id',
        kind: 'single_block',
      }),
    );
    expect(envelope.referenceIndex.blockRefs).toContainEqual(
      expect.objectContaining({
        blockSourceId: 'regular-block-id',
        locale: 'pt',
        kind: 'rich_text',
      }),
    );
    expect(envelope.referenceIndex.structuredTextRefs).toContainEqual(
      expect.objectContaining({
        targetSourceId: 'inline',
        targetType: 'block',
        jsonPath: '$.records[0].content.document.children[0].children[0].item',
      }),
    );
    expect(envelope.referenceIndex.recordRefs).toContainEqual(
      expect.objectContaining({
        sourceBlockId: 'inline',
        targetSourceId: 'linked-inline',
        jsonPath:
          '$.records[0].content.document.children[0].children[0].item.attributes.target',
      }),
    );
    expect(
      envelope.referenceIndex.blockRefs.filter(
        (ref) => ref.blockSourceId === 'inline',
      ),
    ).toHaveLength(1);
  });

  test('supports raw schema/records and escapes special property keys in JSON paths', () => {
    const key = '[quoted]"\n';
    const fields = [
      {
        id: 'field',
        type: 'field',
        attributes: { api_key: key, field_type: 'link', localized: true },
        relationships: { item_type: { data: { id: 'page' } } },
      },
    ];
    const envelope = buildEnvelope(
      [
        {
          id: 'raw-record',
          type: 'item',
          relationships: { item_type: { data: { id: 'page' } } },
          attributes: { [key]: { 'pt-BR': 'linked' } },
        },
      ],
      fields,
    );
    expect(envelope.schema.fieldIdToApiKey.field).toBe(key);
    expect(envelope.referenceIndex.recordRefs).toEqual([
      expect.objectContaining({
        fieldApiKey: key,
        locale: 'pt-BR',
        targetSourceId: 'linked',
        jsonPath: `$.records[0].attributes[${JSON.stringify(key)}]["pt-BR"]`,
      }),
    ]);
  });

  test('traverses deep content with a work stack and keeps all references across bounded parts', () => {
    const fields = [
      {
        id: 'field',
        item_type: { id: 'page' },
        api_key: 'related',
        field_type: 'links',
        localized: true,
      },
    ];
    const records = Array.from({ length: 1001 }, (_, index) => ({
      id: `record-${index}`,
      item_type: { id: 'page' },
      related: { en: [`target-${index}`, 'shared'], pt: [`target-${index}`] },
    }));
    const first = buildEnvelope(records.slice(0, 1000), fields);
    const final = buildRecordExportEnvelope({
      records: records.slice(1000),
      fields,
      itemTypes: [{ id: 'page', api_key: 'page' }],
      siteInfo,
      filtersUsed: {},
      scope: 'bulk',
      partition: {
        exportId: 'export',
        index: 2,
        recordOffset: 1000,
        isLast: true,
      },
    });
    expect(first.referenceIndex.recordRefs).toHaveLength(3000);
    expect(final.referenceIndex.recordRefs).toHaveLength(3);
    expect(final.referenceIndex.recordRefs[0].jsonPath).toBe(
      '$.records[0].related.en[0]',
    );
    expect(final.manifest.partition).toEqual({
      exportId: 'export',
      index: 2,
      recordOffset: 1000,
      isLast: true,
    });

    let nested: Record<string, unknown> = { type: 'item', id: 'deep-target' };
    for (let index = 0; index < 2000; index++) {
      nested = { child: nested };
    }
    const deep = buildEnvelope(
      [{ id: 'deep-record', item_type: { id: 'page' }, custom: nested }],
      [],
    );
    expect(deep.referenceIndex.recordRefs).toHaveLength(1);
    expect(deep.referenceIndex.recordRefs[0].targetSourceId).toBe(
      'deep-target',
    );
  });

  test('builds schema maps and deep reference index for nested content', () => {
    const itemTypes = [
      { id: 'model_page', api_key: 'page' },
      { id: 'block_hero', api_key: 'hero_block', modular_block: true },
      { id: 'block_cta', api_key: 'cta_block', modular_block: true },
    ];

    const fields = [
      {
        id: 'f_related',
        item_type: { id: 'model_page' },
        api_key: 'related',
        field_type: 'link',
        localized: false,
      },
      {
        id: 'f_related_items',
        item_type: { id: 'model_page' },
        api_key: 'related_items',
        field_type: 'links',
        localized: false,
      },
      {
        id: 'f_cover',
        item_type: { id: 'model_page' },
        api_key: 'cover',
        field_type: 'file',
        localized: false,
      },
      {
        id: 'f_gallery',
        item_type: { id: 'model_page' },
        api_key: 'gallery',
        field_type: 'gallery',
        localized: false,
      },
      {
        id: 'f_body',
        item_type: { id: 'model_page' },
        api_key: 'body',
        field_type: 'modular_content',
        localized: false,
      },
      {
        id: 'f_content',
        item_type: { id: 'model_page' },
        api_key: 'content',
        field_type: 'structured_text',
        localized: true,
      },
      {
        id: 'f_linked_cta',
        item_type: { id: 'block_hero' },
        api_key: 'linked_cta',
        field_type: 'link',
        localized: false,
      },
      {
        id: 'f_assets',
        item_type: { id: 'block_hero' },
        api_key: 'assets',
        field_type: 'gallery',
        localized: false,
      },
      {
        id: 'f_nested',
        item_type: { id: 'block_hero' },
        api_key: 'nested',
        field_type: 'single_block',
        localized: false,
      },
      {
        id: 'f_target',
        item_type: { id: 'block_cta' },
        api_key: 'target',
        field_type: 'link',
        localized: false,
      },
      {
        id: 'f_attachment',
        item_type: { id: 'block_cta' },
        api_key: 'attachment',
        field_type: 'file',
        localized: false,
      },
    ];

    const records = [
      {
        id: 'record-100',
        item_type: { id: 'model_page' },
        related: 'record-200',
        related_items: ['record-201', 'record-202'],
        cover: 'upload-1',
        gallery: ['upload-2'],
        body: [
          {
            id: 'block-1',
            item_type: { id: 'block_hero' },
            linked_cta: 'record-300',
            assets: ['upload-3'],
            nested: {
              id: 'block-2',
              item_type: { id: 'block_cta' },
              target: 'record-301',
              attachment: 'upload-4',
            },
          },
        ],
        content: {
          en: {
            schema: 'dast',
            links: ['record-402'],
            blocks: [
              {
                id: 'block-3',
                item_type: { id: 'block_cta' },
                target: 'record-403',
                attachment: 'upload-5',
              },
            ],
            document: {
              type: 'root',
              children: [
                {
                  type: 'paragraph',
                  children: [
                    { type: 'itemLink', item: 'record-400' },
                    { type: 'inlineItem', item: 'record-401' },
                    { type: 'block', item: 'block-3' },
                  ],
                },
              ],
            },
          },
          pt: {
            schema: 'dast',
            links: [{ id: 'record-405' }],
            blocks: ['block-4'],
            document: {
              type: 'root',
              children: [
                {
                  type: 'paragraph',
                  children: [{ type: 'itemLink', item: { id: 'record-404' } }],
                },
              ],
            },
          },
        },
      },
    ];

    const envelope = buildRecordExportEnvelope({
      records: records as Record<string, unknown>[],
      itemTypes: itemTypes as Record<string, unknown>[],
      fields: fields as Record<string, unknown>[],
      siteInfo,
      filtersUsed: { modelIDs: ['model_page'], textQuery: 'landing' },
      scope: 'bulk',
    });

    expect(envelope.manifest.exportVersion).toBe('2.1.0');
    expect(envelope.manifest.sourceProjectId).toBe('project-1');
    expect(envelope.manifest.configurationExport.includedResources).toContain(
      'site',
    );
    expect(envelope.manifest.configurationExport.warningCount).toBe(0);
    expect(envelope.schema.itemTypeIdToApiKey.model_page).toBe('page');
    expect(envelope.schema.fieldIdToApiKey.f_related).toBe('related');
    expect(envelope.schema.fieldsByItemType.model_page).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          apiKey: 'content',
          fieldType: 'structured_text',
          localized: true,
        }),
      ]),
    );

    const recordTargets = new Set(
      envelope.referenceIndex.recordRefs.map(
        (reference) => reference.targetSourceId,
      ),
    );
    const uploadTargets = new Set(
      envelope.referenceIndex.uploadRefs.map(
        (reference) => reference.targetSourceId,
      ),
    );
    const blockTargets = new Set(
      envelope.referenceIndex.blockRefs.map(
        (reference) => reference.blockSourceId,
      ),
    );

    for (const expectedTarget of [
      'record-200',
      'record-201',
      'record-202',
      'record-300',
      'record-301',
      'record-400',
      'record-401',
      'record-402',
      'record-403',
      'record-404',
      'record-405',
    ]) {
      expect(recordTargets.has(expectedTarget)).toBe(true);
    }

    for (const expectedTarget of [
      'upload-1',
      'upload-2',
      'upload-3',
      'upload-4',
      'upload-5',
    ]) {
      expect(uploadTargets.has(expectedTarget)).toBe(true);
    }

    for (const expectedTarget of ['block-1', 'block-2', 'block-3', 'block-4']) {
      expect(blockTargets.has(expectedTarget)).toBe(true);
    }

    expect(
      envelope.referenceIndex.structuredTextRefs.some(
        (reference) =>
          reference.targetSourceId === 'record-400' &&
          reference.kind === 'link' &&
          reference.locale === 'en',
      ),
    ).toBe(true);

    expect(
      envelope.referenceIndex.structuredTextRefs.some(
        (reference) =>
          reference.targetSourceId === 'block-3' &&
          reference.targetType === 'block' &&
          reference.kind === 'block' &&
          reference.locale === 'en',
      ),
    ).toBe(true);

    expect(envelope.assetPackageInfo.manifestFilename).toBe('manifest.json');
    expect(envelope.assetPackageInfo.zipEntryNamingConvention).toContain(
      '<sourceUploadId>',
    );
    expect(envelope.projectConfiguration.site).toBeNull();
    expect(envelope.projectConfiguration.menuItems).toEqual([]);
  });
});

describe('project configuration export', () => {
  const createClient = (
    operation: (resource: string, itemTypeId?: string) => Promise<unknown>,
  ) => ({
    site: { find: vi.fn(() => operation('site')) },
    fieldsets: { list: vi.fn((id: string) => operation('fieldsets', id)) },
    menuItems: { list: vi.fn(() => operation('menuItems')) },
    schemaMenuItems: { list: vi.fn(() => operation('schemaMenuItems')) },
    itemTypeFilters: { list: vi.fn(() => operation('modelFilters')) },
    plugins: { list: vi.fn(() => operation('plugins')) },
    workflows: { list: vi.fn(() => operation('workflows')) },
    roles: { list: vi.fn(() => operation('roles')) },
    webhooks: { list: vi.fn(() => operation('webhooks')) },
    buildTriggers: { list: vi.fn(() => operation('buildTriggers')) },
  });
  const asClient = (client: ReturnType<typeof createClient>) =>
    client as unknown as Parameters<
      typeof fetchProjectConfigurationExport
    >[0]['client'];

  test('bounds configuration concurrency with hundreds of models and records partial failures', async () => {
    let active = 0;
    let peakActive = 0;
    const client = createClient(async (resource, id) => {
      active++;
      peakActive = Math.max(peakActive, active);
      await Promise.resolve();
      active--;
      if (resource === 'fieldsets' && id === 'model-17')
        throw new Error('Unavailable');
      if (resource === 'webhooks') throw new Error('Forbidden');
      return resource === 'site'
        ? { id: 'project', locales: ['en', 'pt-BR'], environment: 'sandbox' }
        : [{ id: id ?? resource }];
    });
    const itemTypes = Array.from({ length: 250 }, (_, index) => ({
      id: `model-${index}`,
    }));
    const result = await fetchProjectConfigurationExport({
      client: asClient(client),
      itemTypes: [...itemTypes, itemTypes[0]],
      records: [],
    });
    expect(peakActive).toBe(3);
    expect(client.fieldsets.list).toHaveBeenCalledTimes(250);
    expect(result.projectConfiguration.fieldsets).toHaveLength(249);
    expect(result.projectConfiguration.webhooks).toEqual([]);
    expect(result.projectConfiguration.warnings).toEqual(
      expect.arrayContaining([
        { resource: 'fieldsets', message: 'Item type model-17: Unavailable' },
        { resource: 'webhooks', message: 'Forbidden' },
      ]),
    );
    expect(result.siteInfo).toEqual({
      sourceProjectId: 'project',
      sourceEnvironment: 'sandbox',
      defaultLocale: 'en',
      locales: ['en', 'pt-BR'],
    });
  });

  test('aborts configuration fetch without converting cancellation into partial-export warnings', async () => {
    const controller = new AbortController();
    const client = createClient(async (resource) => {
      if (resource === 'fieldsets') controller.abort();
      return resource === 'site' ? { id: 'project', locales: ['en'] } : [];
    });
    await expect(
      fetchProjectConfigurationExport({
        client: asClient(client),
        itemTypes: [{ id: 'first' }, { id: 'second' }, { id: 'third' }],
        records: [],
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(client.fieldsets.list).toHaveBeenCalledTimes(1);
    expect(client.menuItems.list).not.toHaveBeenCalled();
  });

  test('collects scheduled actions incrementally per part from flat and raw CMA records', () => {
    const configuration = {
      scheduledPublications: [],
      scheduledUnpublishings: [],
    } as Parameters<typeof appendScheduledActions>[0];
    appendScheduledActions(configuration, [
      {
        id: 'first',
        item_type: { id: 'page' },
        meta: {
          publication_scheduled_at: '2030-01-01T00:00:00Z',
          current_version: 'v1',
        },
      },
    ]);
    appendScheduledActions(configuration, [
      {
        id: 'second',
        type: 'item',
        relationships: { item_type: { data: { id: 'page' } } },
        attributes: { unpublishing_scheduled_at: '2030-02-01T00:00:00Z' },
        meta: { current_version: 'v2' },
      },
      { id: 'no-schedule' },
    ]);
    expect(configuration.scheduledPublications).toEqual([
      {
        itemId: 'first',
        itemTypeId: 'page',
        scheduledAt: '2030-01-01T00:00:00Z',
        currentVersion: 'v1',
      },
    ]);
    expect(configuration.scheduledUnpublishings).toEqual([
      {
        itemId: 'second',
        itemTypeId: 'page',
        scheduledAt: '2030-02-01T00:00:00Z',
        currentVersion: 'v2',
      },
    ]);
  });
});
