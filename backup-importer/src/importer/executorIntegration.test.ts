/// <reference types="vitest" />

import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { RecordExportEnvelope } from './types';

const { buildClientMock } = vi.hoisted(() => ({
  buildClientMock: vi.fn(),
}));

vi.mock('@datocms/cma-client-browser', () => ({
  buildClient: buildClientMock,
}));

import { executeImportFromEnvelope } from './executor';

function buildEnvelope(args: {
  recordCount: number;
  includeLinkField: boolean;
}): RecordExportEnvelope {
  const records = Array.from({ length: args.recordCount }, (_, index) => {
    const sourceId =
      args.recordCount === 2 ? `record-${index === 0 ? 'a' : 'b'}` : `record-${index}`;
    const nextIndex = (index + 1) % args.recordCount;
    const nextId =
      args.recordCount === 2
        ? `record-${nextIndex === 0 ? 'a' : 'b'}`
        : `record-${nextIndex}`;

    return {
      id: sourceId,
      item_type: { id: 'source_model_page' },
      title: `Title ${index}`,
      ...(args.includeLinkField ? { related: nextId } : {}),
    };
  });

  const fields = [
    {
      id: 'source_field_title',
      api_key: 'title',
      field_type: 'string',
      localized: false,
      item_type: { id: 'source_model_page' },
    },
  ];

  if (args.includeLinkField) {
    fields.push({
      id: 'source_field_related',
      api_key: 'related',
      field_type: 'link',
      localized: false,
      item_type: { id: 'source_model_page' },
    });
  }

  return {
    manifest: {
      exportVersion: '2.1.0',
      pluginVersion: '1.0.0',
      exportedAt: '2026-02-10T20:00:00.000Z',
      sourceProjectId: 'project-1',
      sourceEnvironment: 'main',
      defaultLocale: 'en',
      locales: ['en'],
      scope: 'bulk',
      filtersUsed: {},
    },
    schema: {
      itemTypes: [{ id: 'source_model_page', api_key: 'page' }],
      fields,
      itemTypeIdToApiKey: {
        source_model_page: 'page',
      },
      fieldIdToApiKey: {
        source_field_title: 'title',
        ...(args.includeLinkField ? { source_field_related: 'related' } : {}),
      },
      fieldsByItemType: {
        source_model_page: [
          {
            fieldId: 'source_field_title',
            apiKey: 'title',
            fieldType: 'string',
            localized: false,
          },
          ...(args.includeLinkField
            ? [
                {
                  fieldId: 'source_field_related',
                  apiKey: 'related',
                  fieldType: 'link',
                  localized: false,
                },
              ]
            : []),
        ],
      },
    },
    projectConfiguration: {
      site: {
        id: 'site-1',
        locales: ['en'],
        timezone: 'UTC',
      },
      scheduledPublications: [],
      scheduledUnpublishings: [],
      fieldsets: [],
      menuItems: [],
      schemaMenuItems: [],
      modelFilters: [],
      plugins: [],
      workflows: [],
      roles: [],
      webhooks: [],
      buildTriggers: [],
      warnings: [],
    },
    records,
    referenceIndex: {
      recordRefs: args.includeLinkField
        ? records.map((record, index) => {
            const sourceId = record.id as string;
            const nextIndex = (index + 1) % args.recordCount;
            const nextId =
              args.recordCount === 2
                ? `record-${nextIndex === 0 ? 'a' : 'b'}`
                : `record-${nextIndex}`;

            return {
              recordSourceId: sourceId,
              sourceBlockId: null,
              fieldApiKey: 'related',
              locale: null,
              jsonPath: `$.records[${index}].related`,
              targetSourceId: nextId,
              kind: 'link',
            };
          })
        : [],
      uploadRefs: [],
      structuredTextRefs: [],
      blockRefs: [],
    },
  };
}

function createMockClient(args: {
  includeLinkField: boolean;
  existingRecordIds?: string[];
}) {
  let createCounter = 0;
  const existingRecordIds = new Set(args.existingRecordIds ?? []);
  const create = vi.fn(async () => {
    createCounter += 1;
    return {
      id: `target-record-${createCounter}`,
    };
  });
  const update = vi.fn(async (targetRecordId: string, payload: unknown) => ({
    id: targetRecordId,
    ...((payload as Record<string, unknown>) ?? {}),
  }));
  const publish = vi.fn(async (targetRecordId: string) => ({ id: targetRecordId }));

  const fieldsList = [
    {
      id: 'target_field_title',
      api_key: 'title',
      field_type: 'string',
      localized: false,
    },
  ];

  if (args.includeLinkField) {
    fieldsList.push({
      id: 'target_field_related',
      api_key: 'related',
      field_type: 'link',
      localized: false,
    });
  }

  const makeConfigId = () => ({ id: `cfg-${Math.random()}` });
  const siteUpdate = vi.fn(async (payload: unknown) => ({
    id: 'site-1',
    ...((payload as Record<string, unknown>) ?? {}),
  }));
  const itemTypesCreate = vi.fn(async () => ({ id: `cfg-${Math.random()}` }));
  const itemTypesUpdate = vi.fn(async (id: string, payload: unknown) => ({
    id,
    ...((payload as Record<string, unknown>) ?? {}),
  }));
  const fieldsCreate = vi.fn(async () => ({ id: `cfg-${Math.random()}` }));
  const fieldsUpdate = vi.fn(async (id: string, payload: unknown) => ({
    id,
    ...((payload as Record<string, unknown>) ?? {}),
  }));
  const pluginsCreate = vi.fn(async () => ({ id: `cfg-${Math.random()}` }));
  const pluginsUpdate = vi.fn(async (id: string, payload: unknown) => ({
    id,
    ...((payload as Record<string, unknown>) ?? {}),
  }));
  const itemTypesList = vi.fn(async () => [
    {
      id: 'target_model_page',
      api_key: 'page',
    },
  ]);
  const pluginsList = vi.fn(async () => []);
  const workflowsList = vi.fn(async () => []);
  const workflowsCreate = vi.fn(async () => makeConfigId());
  const workflowsUpdate = vi.fn(async (id: string, payload: unknown) => ({
    id,
    ...((payload as Record<string, unknown>) ?? {}),
  }));
  const rolesList = vi.fn(async () => []);
  const rolesCreate = vi.fn(async () => makeConfigId());
  const rolesUpdate = vi.fn(async (id: string, payload: unknown) => ({
    id,
    ...((payload as Record<string, unknown>) ?? {}),
  }));
  const itemTypeFiltersList = vi.fn(async () => []);
  const itemTypeFiltersCreate = vi.fn(async () => makeConfigId());
  const itemTypeFiltersUpdate = vi.fn(async (id: string, payload: unknown) => ({
    id,
    ...((payload as Record<string, unknown>) ?? {}),
  }));
  const menuItemsList = vi.fn(async () => []);
  const menuItemsCreate = vi.fn(async () => makeConfigId());
  const menuItemsUpdate = vi.fn(async (id: string, payload: unknown) => ({
    id,
    ...((payload as Record<string, unknown>) ?? {}),
  }));
  const schemaMenuItemsList = vi.fn(async () => []);
  const schemaMenuItemsCreate = vi.fn(async () => makeConfigId());
  const schemaMenuItemsUpdate = vi.fn(async (id: string, payload: unknown) => ({
    id,
    ...((payload as Record<string, unknown>) ?? {}),
  }));
  const webhooksList = vi.fn(async () => []);
  const webhooksCreate = vi.fn(async () => makeConfigId());
  const webhooksUpdate = vi.fn(async (id: string, payload: unknown) => ({
    id,
    ...((payload as Record<string, unknown>) ?? {}),
  }));
  const buildTriggersList = vi.fn(async () => []);
  const buildTriggersCreate = vi.fn(async () => makeConfigId());
  const buildTriggersUpdate = vi.fn(async (id: string, payload: unknown) => ({
    id,
    ...((payload as Record<string, unknown>) ?? {}),
  }));
  const scheduledPublicationCreate = vi.fn(async () => makeConfigId());
  const scheduledPublicationDestroy = vi.fn(async () => undefined);
  const scheduledUnpublishingCreate = vi.fn(async () => makeConfigId());
  const scheduledUnpublishingDestroy = vi.fn(async () => undefined);
  const fieldsetsList = vi.fn(async () => []);
  const fieldsetsCreate = vi.fn(async () => makeConfigId());
  const fieldsListFn = vi.fn(async () => fieldsList);
  const itemsList = vi.fn(async (query: any) => {
    const rawIds = query?.filter?.ids;
    if (typeof rawIds !== 'string' || rawIds.length === 0) {
      return [];
    }

    return rawIds
      .split(',')
      .map((id: string) => id.trim())
      .filter((id: string) => existingRecordIds.has(id))
      .map((id: string) => ({
        id,
      }));
  });

  return {
    client: {
      site: {
        update: siteUpdate,
      },
      itemTypes: {
        list: itemTypesList,
        create: itemTypesCreate,
        update: itemTypesUpdate,
      },
      fieldsets: {
        list: fieldsetsList,
        create: fieldsetsCreate,
      },
      fields: {
        list: fieldsListFn,
        create: fieldsCreate,
        update: fieldsUpdate,
      },
      workflows: {
        list: workflowsList,
        create: workflowsCreate,
        update: workflowsUpdate,
      },
      roles: {
        list: rolesList,
        create: rolesCreate,
        update: rolesUpdate,
      },
      plugins: {
        list: pluginsList,
        create: pluginsCreate,
        update: pluginsUpdate,
      },
      itemTypeFilters: {
        list: itemTypeFiltersList,
        create: itemTypeFiltersCreate,
        update: itemTypeFiltersUpdate,
      },
      menuItems: {
        list: menuItemsList,
        create: menuItemsCreate,
        update: menuItemsUpdate,
      },
      schemaMenuItems: {
        list: schemaMenuItemsList,
        create: schemaMenuItemsCreate,
        update: schemaMenuItemsUpdate,
      },
      webhooks: {
        list: webhooksList,
        create: webhooksCreate,
        update: webhooksUpdate,
      },
      buildTriggers: {
        list: buildTriggersList,
        create: buildTriggersCreate,
        update: buildTriggersUpdate,
      },
      scheduledPublication: {
        create: scheduledPublicationCreate,
        destroy: scheduledPublicationDestroy,
      },
      scheduledUnpublishing: {
        create: scheduledUnpublishingCreate,
        destroy: scheduledUnpublishingDestroy,
      },
      items: {
        list: itemsList,
        create,
        update,
        publish,
      },
      uploads: {
        listPagedIterator: async function* listPagedIterator() {
          // No-op iterator for tests that do not import assets.
        },
      },
    },
    create,
    update,
    publish,
    itemTypesList,
    pluginsList,
    siteUpdate,
    itemTypesCreate,
    itemTypesUpdate,
    fieldsCreate,
    fieldsUpdate,
    pluginsCreate,
    pluginsUpdate,
    workflowsList,
    workflowsCreate,
    workflowsUpdate,
    rolesList,
    rolesCreate,
    rolesUpdate,
    itemTypeFiltersList,
    itemTypeFiltersCreate,
    itemTypeFiltersUpdate,
    menuItemsList,
    menuItemsCreate,
    menuItemsUpdate,
    schemaMenuItemsList,
    schemaMenuItemsCreate,
    schemaMenuItemsUpdate,
    webhooksList,
    webhooksCreate,
    webhooksUpdate,
    buildTriggersList,
    buildTriggersCreate,
    buildTriggersUpdate,
    scheduledPublicationCreate,
    scheduledPublicationDestroy,
    scheduledUnpublishingCreate,
    scheduledUnpublishingDestroy,
    fieldsetsList,
    fieldsetsCreate,
    fieldsListFn,
    itemsList,
  };
}

function buildComplexEnvelope(): RecordExportEnvelope {
  return {
    manifest: {
      exportVersion: '2.1.0',
      pluginVersion: '1.0.0',
      exportedAt: '2026-02-10T21:00:00.000Z',
      sourceProjectId: 'project-1',
      sourceEnvironment: 'main',
      defaultLocale: 'en',
      locales: ['en'],
      scope: 'bulk',
      filtersUsed: {},
    },
    schema: {
      itemTypes: [
        { id: 'source_model_page', api_key: 'page' },
        { id: 'source_block_hero', api_key: 'hero_block' },
      ],
      fields: [
        {
          id: 'source_field_title',
          api_key: 'title',
          field_type: 'string',
          localized: false,
          item_type: { id: 'source_model_page' },
        },
        {
          id: 'source_field_related',
          api_key: 'related',
          field_type: 'link',
          localized: false,
          item_type: { id: 'source_model_page' },
        },
        {
          id: 'source_field_cover',
          api_key: 'cover',
          field_type: 'file',
          localized: false,
          item_type: { id: 'source_model_page' },
        },
        {
          id: 'source_field_content',
          api_key: 'content',
          field_type: 'structured_text',
          localized: false,
          item_type: { id: 'source_model_page' },
        },
        {
          id: 'source_field_body',
          api_key: 'body',
          field_type: 'modular_content',
          localized: false,
          item_type: { id: 'source_model_page' },
        },
        {
          id: 'source_block_field_cta',
          api_key: 'cta',
          field_type: 'link',
          localized: false,
          item_type: { id: 'source_block_hero' },
        },
      ],
      itemTypeIdToApiKey: {
        source_model_page: 'page',
        source_block_hero: 'hero_block',
      },
      fieldIdToApiKey: {
        source_field_title: 'title',
        source_field_related: 'related',
        source_field_cover: 'cover',
        source_field_content: 'content',
        source_field_body: 'body',
        source_block_field_cta: 'cta',
      },
      fieldsByItemType: {
        source_model_page: [
          {
            fieldId: 'source_field_title',
            apiKey: 'title',
            fieldType: 'string',
            localized: false,
          },
          {
            fieldId: 'source_field_related',
            apiKey: 'related',
            fieldType: 'link',
            localized: false,
          },
          {
            fieldId: 'source_field_cover',
            apiKey: 'cover',
            fieldType: 'file',
            localized: false,
          },
          {
            fieldId: 'source_field_content',
            apiKey: 'content',
            fieldType: 'structured_text',
            localized: false,
          },
          {
            fieldId: 'source_field_body',
            apiKey: 'body',
            fieldType: 'modular_content',
            localized: false,
          },
        ],
        source_block_hero: [
          {
            fieldId: 'source_block_field_cta',
            apiKey: 'cta',
            fieldType: 'link',
            localized: false,
          },
        ],
      },
    },
    projectConfiguration: {
      site: {
        id: 'site-1',
        locales: ['en'],
        timezone: 'UTC',
      },
      scheduledPublications: [],
      scheduledUnpublishings: [],
      fieldsets: [],
      menuItems: [],
      schemaMenuItems: [],
      modelFilters: [],
      plugins: [],
      workflows: [],
      roles: [],
      webhooks: [],
      buildTriggers: [],
      warnings: [],
    },
    records: [
      {
        id: 'record-a',
        item_type: { id: 'source_model_page' },
        title: 'Record A',
        related: 'record-b',
        cover: 'upload-1',
        body: [
          {
            id: 'block-1',
            item_type: { id: 'source_block_hero' },
            cta: 'record-b',
          },
        ],
        content: {
          schema: 'dast',
          links: ['record-b'],
          blocks: ['block-1'],
          document: {
            type: 'root',
            children: [
              {
                type: 'paragraph',
                children: [
                  { type: 'itemLink', item: 'record-b' },
                  { type: 'block', item: 'block-1' },
                ],
              },
            ],
          },
        },
      },
      {
        id: 'record-b',
        item_type: { id: 'source_model_page' },
        title: 'Record B',
      },
    ],
    referenceIndex: {
      recordRefs: [
        {
          recordSourceId: 'record-a',
          sourceBlockId: null,
          fieldApiKey: 'related',
          locale: null,
          jsonPath: '$.records[0].related',
          targetSourceId: 'record-b',
          kind: 'link',
        },
        {
          recordSourceId: 'record-a',
          sourceBlockId: 'block-1',
          fieldApiKey: 'cta',
          locale: null,
          jsonPath: '$.records[0].body[0].cta',
          targetSourceId: 'record-b',
          kind: 'link',
        },
      ],
      uploadRefs: [
        {
          recordSourceId: 'record-a',
          sourceBlockId: null,
          fieldApiKey: 'cover',
          locale: null,
          jsonPath: '$.records[0].cover',
          targetSourceId: 'upload-1',
          kind: 'file',
        },
      ],
      structuredTextRefs: [
        {
          recordSourceId: 'record-a',
          sourceBlockId: null,
          fieldApiKey: 'content',
          locale: null,
          jsonPath: '$.records[0].content.links[0]',
          targetSourceId: 'record-b',
          targetType: 'record',
          kind: 'link',
        },
        {
          recordSourceId: 'record-a',
          sourceBlockId: null,
          fieldApiKey: 'content',
          locale: null,
          jsonPath: '$.records[0].content.blocks[0]',
          targetSourceId: 'block-1',
          targetType: 'block',
          kind: 'block',
        },
      ],
      blockRefs: [
        {
          recordSourceId: 'record-a',
          sourceBlockId: null,
          fieldApiKey: 'body',
          locale: null,
          jsonPath: '$.records[0].body[0]',
          blockSourceId: 'block-1',
          blockModelId: 'source_block_hero',
          parentBlockSourceId: null,
          kind: 'modular_content',
          synthetic: false,
        },
      ],
    },
  };
}

function createComplexMockClient() {
  let createCounter = 0;
  const create = vi.fn(async () => {
    createCounter += 1;
    return { id: `target-record-${createCounter}` };
  });
  const update = vi.fn(async (targetRecordId: string, payload: unknown) => ({
    id: targetRecordId,
    ...((payload as Record<string, unknown>) ?? {}),
  }));

  const noopList = vi.fn(async () => []);
  const noopCreate = vi.fn(async () => ({ id: `cfg-${Math.random()}` }));
  const noopUpdate = vi.fn(async (id: string, payload: unknown) => ({
    id,
    ...((payload as Record<string, unknown>) ?? {}),
  }));

  return {
    client: {
      site: {
        update: vi.fn(async (payload: unknown) => ({
          id: 'site-1',
          ...((payload as Record<string, unknown>) ?? {}),
        })),
      },
      itemTypes: {
        list: vi.fn(async () => [
          {
            id: 'target_model_page',
            api_key: 'page',
          },
          {
            id: 'target_block_hero',
            api_key: 'hero_block',
          },
        ]),
        create: noopCreate,
        update: noopUpdate,
      },
      fieldsets: {
        list: vi.fn(async () => []),
        create: noopCreate,
      },
      fields: {
        list: vi.fn(async (itemTypeId: string) => {
          if (itemTypeId === 'target_model_page') {
            return [
              {
                id: 'target_field_title',
                api_key: 'title',
                field_type: 'string',
                localized: false,
              },
              {
                id: 'target_field_related',
                api_key: 'related',
                field_type: 'link',
                localized: false,
              },
              {
                id: 'target_field_cover',
                api_key: 'cover',
                field_type: 'file',
                localized: false,
              },
              {
                id: 'target_field_content',
                api_key: 'content',
                field_type: 'structured_text',
                localized: false,
              },
              {
                id: 'target_field_body',
                api_key: 'body',
                field_type: 'modular_content',
                localized: false,
              },
            ];
          }

          if (itemTypeId === 'target_block_hero') {
            return [
              {
                id: 'target_block_field_cta',
                api_key: 'cta',
                field_type: 'link',
                localized: false,
              },
            ];
          }

          return [];
        }),
        create: noopCreate,
        update: noopUpdate,
      },
      workflows: {
        list: noopList,
        create: noopCreate,
        update: noopUpdate,
      },
      roles: {
        list: noopList,
        create: noopCreate,
        update: noopUpdate,
      },
      plugins: {
        list: noopList,
        create: noopCreate,
        update: noopUpdate,
      },
      itemTypeFilters: {
        list: noopList,
        create: noopCreate,
        update: noopUpdate,
      },
      menuItems: {
        list: noopList,
        create: noopCreate,
        update: noopUpdate,
      },
      schemaMenuItems: {
        list: noopList,
        create: noopCreate,
        update: noopUpdate,
      },
      webhooks: {
        list: noopList,
        create: noopCreate,
        update: noopUpdate,
      },
      buildTriggers: {
        list: noopList,
        create: noopCreate,
        update: noopUpdate,
      },
      scheduledPublication: {
        create: noopCreate,
        destroy: vi.fn(async () => undefined),
      },
      scheduledUnpublishing: {
        create: noopCreate,
        destroy: vi.fn(async () => undefined),
      },
      items: {
        list: vi.fn(async () => []),
        create,
        update,
        publish: vi.fn(async (targetRecordId: string) => ({ id: targetRecordId })),
      },
      uploads: {
        listPagedIterator: async function* listPagedIterator() {
          // No-op iterator for tests that do not import asset ZIPs.
        },
      },
    },
    create,
    update,
  };
}

describe('executeImportFromEnvelope integration', () => {
  beforeEach(() => {
    buildClientMock.mockReset();
  });

  test('imports circular links by bootstrapping IDs then patching links', async () => {
    const envelope = buildEnvelope({
      recordCount: 2,
      includeLinkField: true,
    });
    const mock = createMockClient({ includeLinkField: true });
    buildClientMock.mockResolvedValue(mock.client);

    const report = await executeImportFromEnvelope({
      envelopeRaw: envelope,
      apiToken: 'token',
      environment: 'main',
      options: {
        strictMode: true,
        resumeFromCheckpoint: false,
        publishAfterImport: false,
      },
    });

    expect(report.ok).toBe(true);
    expect(report.createdCount).toBe(2);
    expect(report.updatedCount).toBe(2);
    expect(mock.create).toHaveBeenCalledTimes(2);
    expect(mock.update).toHaveBeenCalledTimes(2);

    const targetA = report.recordIdMap.get('record-a');
    const targetB = report.recordIdMap.get('record-b');

    const updateCallA = mock.update.mock.calls.find(([targetId]) => targetId === targetA);
    const updateCallB = mock.update.mock.calls.find(([targetId]) => targetId === targetB);

    expect(updateCallA?.[1]).toMatchObject({ related: targetB });
    expect(updateCallB?.[1]).toMatchObject({ related: targetA });
  });

  test('add-only mode skips existing records matched by source ID', async () => {
    const envelope = buildEnvelope({
      recordCount: 2,
      includeLinkField: false,
    });
    const mock = createMockClient({
      includeLinkField: false,
      existingRecordIds: ['record-a'],
    });
    buildClientMock.mockResolvedValue(mock.client);

    const report = await executeImportFromEnvelope({
      envelopeRaw: envelope,
      apiToken: 'token',
      environment: 'main',
      options: {
        strictMode: true,
        addOnlyDifferences: true,
        resumeFromCheckpoint: false,
        publishAfterImport: false,
      },
    });

    expect(report.ok).toBe(true);
    expect(report.addOnlyDifferencesEnabled).toBe(true);
    expect(report.existingRecordMatches).toBe(1);
    expect(report.skippedExistingRecords).toBe(1);
    expect(report.skippedExistingByResource.records).toBe(1);
    expect(report.recordIdMap.get('record-a')).toBe('record-a');
    expect(report.createdCount).toBe(1);
    expect(report.updatedCount).toBe(1);
    expect(mock.create).toHaveBeenCalledTimes(1);
    expect(mock.update).toHaveBeenCalledTimes(1);
    expect(
      report.warnings.some((entry) =>
        entry.includes("[add-only][records] Skipped existing record 'record-a'"),
      ),
    ).toBe(true);
  });

  test('add-only preflight ignores skipped existing records and resolves links to them', async () => {
    const envelope = buildEnvelope({
      recordCount: 2,
      includeLinkField: true,
    });
    const mock = createMockClient({
      includeLinkField: true,
      existingRecordIds: ['record-a'],
    });
    buildClientMock.mockResolvedValue(mock.client);

    const report = await executeImportFromEnvelope({
      envelopeRaw: envelope,
      apiToken: 'token',
      environment: 'main',
      options: {
        strictMode: true,
        addOnlyDifferences: true,
        resumeFromCheckpoint: false,
        publishAfterImport: false,
      },
    });

    expect(report.ok).toBe(true);
    expect(report.errors).toHaveLength(0);
    expect(report.existingRecordMatches).toBe(1);
    expect(mock.create).toHaveBeenCalledTimes(1);
    expect(mock.update).toHaveBeenCalledTimes(1);
  });

  test('skips bootstrap create for modular block payload records', async () => {
    const envelope = buildEnvelope({
      recordCount: 1,
      includeLinkField: false,
    });
    envelope.schema.itemTypes = [
      {
        id: 'source_model_page',
        api_key: 'page',
        modular_block: true,
      },
    ] as any;

    const mock = createMockClient({ includeLinkField: false });
    buildClientMock.mockResolvedValue(mock.client);

    const report = await executeImportFromEnvelope({
      envelopeRaw: envelope,
      apiToken: 'token',
      environment: 'main',
      options: {
        strictMode: true,
        resumeFromCheckpoint: false,
        publishAfterImport: false,
      },
    });

    expect(report.ok).toBe(true);
    expect(mock.create).not.toHaveBeenCalled();
    expect(report.createdCount).toBe(0);
    expect(
      report.warnings.some((entry) =>
        entry.includes(
          'excluding them from top-level record create/update phases',
        ),
      ),
    ).toBe(true);
  });

  test('add-only mode warns when zero record matches and source environment differs', async () => {
    const envelope = buildEnvelope({
      recordCount: 1,
      includeLinkField: false,
    });
    const mock = createMockClient({ includeLinkField: false });
    buildClientMock.mockResolvedValue(mock.client);

    const report = await executeImportFromEnvelope({
      envelopeRaw: envelope,
      apiToken: 'token',
      environment: 'sandbox',
      options: {
        strictMode: true,
        addOnlyDifferences: true,
        resumeFromCheckpoint: false,
        publishAfterImport: false,
      },
    });

    expect(report.ok).toBe(true);
    expect(report.existingRecordMatches).toBe(0);
    expect(
      report.warnings.some((entry) =>
        entry.includes(
          '[add-only][records] Existing-record ID scan matched zero records',
        ),
      ),
    ).toBe(true);
  });

  test('imports plugins before schema phases', async () => {
    const envelope = buildEnvelope({
      recordCount: 1,
      includeLinkField: false,
    });
    if (envelope.projectConfiguration) {
      envelope.projectConfiguration.plugins = [
        {
          id: 'plugin-source-1',
          package_name: 'example-plugin',
          name: 'Example plugin',
          plugin_type: 'sidebar',
        },
      ] as any;
    }

    const mock = createMockClient({ includeLinkField: false });
    buildClientMock.mockResolvedValue(mock.client);

    const report = await executeImportFromEnvelope({
      envelopeRaw: envelope,
      apiToken: 'token',
      environment: 'main',
      options: {
        strictMode: true,
        resumeFromCheckpoint: false,
        publishAfterImport: false,
      },
    });

    expect(report.ok).toBe(true);
    expect(mock.pluginsList).toHaveBeenCalled();
    expect(mock.itemTypesList).toHaveBeenCalled();
    expect(mock.pluginsList.mock.invocationCallOrder[0]).toBeLessThan(
      mock.itemTypesList.mock.invocationCallOrder[0],
    );
  });

  test('updates all records when patch phase runs in multiple chunks', async () => {
    const envelope = buildEnvelope({
      recordCount: 230,
      includeLinkField: false,
    });
    const mock = createMockClient({ includeLinkField: false });
    buildClientMock.mockResolvedValue(mock.client);

    const report = await executeImportFromEnvelope({
      envelopeRaw: envelope,
      apiToken: 'token',
      environment: 'main',
      options: {
        strictMode: true,
        resumeFromCheckpoint: false,
        publishAfterImport: false,
        concurrency: {
          create: 3,
          update: 2,
          publish: 2,
          upload: 1,
        },
      },
    });

    expect(report.ok).toBe(true);
    expect(report.createdCount).toBe(230);
    expect(report.updatedCount).toBe(230);
    expect(mock.create).toHaveBeenCalledTimes(230);
    expect(mock.update).toHaveBeenCalledTimes(230);
    expect(report.updateFailures).toHaveLength(0);
  });

  test('rewrites structured text, blocks, and uploads in one pass', async () => {
    const envelope = buildComplexEnvelope();
    const mock = createComplexMockClient();
    buildClientMock.mockResolvedValue(mock.client);

    const report = await executeImportFromEnvelope({
      envelopeRaw: envelope,
      apiToken: 'token',
      environment: 'main',
      options: {
        strictMode: true,
        resumeFromCheckpoint: false,
        publishAfterImport: false,
        uploadIdMap: new Map([['upload-1', 'target-upload-1']]),
      },
    });

    expect(report.ok).toBe(true);
    expect(report.createdCount).toBe(2);
    expect(report.updatedCount).toBe(2);

    const targetA = report.recordIdMap.get('record-a');
    const targetB = report.recordIdMap.get('record-b');
    const updateCallA = mock.update.mock.calls.find(([targetId]) => targetId === targetA);
    const payloadA = updateCallA?.[1] as Record<string, unknown>;

    expect(payloadA.related).toBe(targetB);
    expect(payloadA.cover).toBe('target-upload-1');

    const content = payloadA.content as Record<string, unknown>;
    expect(content.links).toEqual([targetB]);
    expect(content.blocks).toEqual(['block-1']);

    const document = content.document as Record<string, unknown>;
    const paragraph = (document.children as Array<Record<string, unknown>>)[0];
    const children = paragraph.children as Array<Record<string, unknown>>;
    expect(children[0].item).toBe(targetB);
    expect(children[1].item).toBe('block-1');

    const body = payloadA.body as Array<Record<string, unknown>>;
    expect(body[0].item_type).toEqual({ id: 'target_block_hero' });
    expect(body[0].cta).toBe(targetB);
  });

  test('skipAssets blanks file fields and bypasses asset import', async () => {
    const envelope = buildComplexEnvelope();
    const mock = createComplexMockClient();
    buildClientMock.mockResolvedValue(mock.client);

    const report = await executeImportFromEnvelope({
      envelopeRaw: envelope,
      apiToken: 'token',
      environment: 'main',
      assetZipFiles: [new File(['dummy'], 'assets.zip', { type: 'application/zip' })],
      options: {
        strictMode: true,
        skipAssets: true,
        resumeFromCheckpoint: false,
        publishAfterImport: false,
      },
    });

    expect(report.ok).toBe(true);
    expect(report.assetImport).toBeNull();
    expect(
      report.warnings.some((warning) => warning.includes('Skip assets enabled')),
    ).toBe(true);

    const targetA = report.recordIdMap.get('record-a');
    const updateCallA = mock.update.mock.calls.find(([targetId]) => targetId === targetA);
    const payloadA = updateCallA?.[1] as Record<string, unknown>;

    expect(payloadA.cover).toBeNull();
  });

  test('fails early when record model mapping cannot be resolved', async () => {
    const envelope = buildEnvelope({
      recordCount: 2,
      includeLinkField: false,
    });
    envelope.schema.itemTypes = [];
    envelope.schema.itemTypeIdToApiKey = {};
    envelope.schema.fields = [];
    envelope.schema.fieldsByItemType = {};
    envelope.schema.fieldIdToApiKey = {};

    const mock = createMockClient({ includeLinkField: false });
    buildClientMock.mockResolvedValue(mock.client);

    const report = await executeImportFromEnvelope({
      envelopeRaw: envelope,
      apiToken: 'token',
      environment: 'main',
      options: {
        strictMode: true,
        resumeFromCheckpoint: false,
        publishAfterImport: false,
      },
    });

    expect(report.ok).toBe(false);
    expect(
      report.errors.some((entry) => entry.includes('Record model mapping error:')),
    ).toBe(true);
    expect(mock.create).not.toHaveBeenCalled();
  });

  test('fails before schema import when site baseline is missing', async () => {
    const envelope = buildEnvelope({
      recordCount: 1,
      includeLinkField: false,
    });
    if (envelope.projectConfiguration) {
      envelope.projectConfiguration.site = null;
    }

    const mock = createMockClient({ includeLinkField: false });
    buildClientMock.mockResolvedValue(mock.client);

    const report = await executeImportFromEnvelope({
      envelopeRaw: envelope,
      apiToken: 'token',
      environment: 'main',
      options: {
        strictMode: true,
        resumeFromCheckpoint: false,
        publishAfterImport: false,
      },
    });

    expect(report.ok).toBe(false);
    expect(
      report.errors.some((message) =>
        message.includes('Site baseline is required before schema import'),
      ),
    ).toBe(true);
    expect(mock.itemTypesList).not.toHaveBeenCalled();
  });

  test('skipSiteSettingsImport continues without site baseline payload', async () => {
    const envelope = buildEnvelope({
      recordCount: 1,
      includeLinkField: false,
    });
    if (envelope.projectConfiguration) {
      envelope.projectConfiguration.site = null;
    }

    const mock = createMockClient({ includeLinkField: false });
    buildClientMock.mockResolvedValue(mock.client);

    const report = await executeImportFromEnvelope({
      envelopeRaw: envelope,
      apiToken: 'token',
      environment: 'main',
      options: {
        strictMode: true,
        skipSiteSettingsImport: true,
        resumeFromCheckpoint: false,
        publishAfterImport: false,
      },
    });

    expect(report.ok).toBe(true);
    expect(mock.siteUpdate).not.toHaveBeenCalled();
    expect(
      report.warnings.some((message) =>
        message.includes('Skipped site settings import phase by option'),
      ),
    ).toBe(true);
  });

  test('skipPluginImport bypasses pre-schema plugin import', async () => {
    const envelope = buildEnvelope({
      recordCount: 1,
      includeLinkField: false,
    });
    if (envelope.projectConfiguration) {
      envelope.projectConfiguration.plugins = [
        {
          id: 'plugin-source-1',
          package_name: 'example-plugin',
          name: 'Example plugin',
          plugin_type: 'sidebar',
        },
      ] as any;
    }

    const mock = createMockClient({ includeLinkField: false });
    buildClientMock.mockResolvedValue(mock.client);

    const report = await executeImportFromEnvelope({
      envelopeRaw: envelope,
      apiToken: 'token',
      environment: 'main',
      options: {
        strictMode: true,
        skipPluginImport: true,
        resumeFromCheckpoint: false,
        publishAfterImport: false,
      },
    });

    expect(report.ok).toBe(true);
    expect(mock.pluginsList).not.toHaveBeenCalled();
    expect(mock.pluginsCreate).not.toHaveBeenCalled();
    expect(
      report.warnings.some((message) =>
        message.includes('Skipped plugin import phase by option'),
      ),
    ).toBe(true);
  });

  test('skipSchemaImport uses existing schema mapping without schema mutations', async () => {
    const envelope = buildEnvelope({
      recordCount: 1,
      includeLinkField: true,
    });
    const mock = createMockClient({ includeLinkField: true });
    buildClientMock.mockResolvedValue(mock.client);

    const report = await executeImportFromEnvelope({
      envelopeRaw: envelope,
      apiToken: 'token',
      environment: 'main',
      options: {
        strictMode: true,
        skipSchemaImport: true,
        resumeFromCheckpoint: false,
        publishAfterImport: false,
      },
    });

    expect(report.ok).toBe(true);
    expect(mock.itemTypesCreate).not.toHaveBeenCalled();
    expect(mock.itemTypesUpdate).not.toHaveBeenCalled();
    expect(mock.fieldsCreate).not.toHaveBeenCalled();
    expect(mock.fieldsUpdate.mock.calls.length).toBeGreaterThan(0);
    expect(report.validationWindowEnabled).toBe(true);
    expect(mock.itemTypesList).toHaveBeenCalled();
    expect(
      report.warnings.some((message) =>
        message.includes('Skipped schema import phases by option'),
      ),
    ).toBe(true);
  });

  test('can skip workflows, roles, filters, and menu configuration resources', async () => {
    const envelope = buildEnvelope({
      recordCount: 1,
      includeLinkField: false,
    });
    if (envelope.projectConfiguration) {
      envelope.projectConfiguration.workflows = [
        {
          id: 'workflow-source-1',
          api_key: 'default',
          name: 'Default',
          stages: [],
        } as any,
      ];
      envelope.projectConfiguration.roles = [
        {
          id: 'role-source-1',
          name: 'Editor',
        } as any,
      ];
      envelope.projectConfiguration.modelFilters = [
        {
          id: 'filter-source-1',
          name: 'Main',
          item_type: { id: 'source_model_page' },
        } as any,
      ];
      envelope.projectConfiguration.menuItems = [
        {
          id: 'menu-source-1',
          label: 'Website',
          external_url: null,
        } as any,
      ];
      envelope.projectConfiguration.schemaMenuItems = [
        {
          id: 'schema-menu-source-1',
          label: 'Models',
          kind: 'separator',
        } as any,
      ];
    }

    const mock = createMockClient({ includeLinkField: false });
    buildClientMock.mockResolvedValue(mock.client);

    const report = await executeImportFromEnvelope({
      envelopeRaw: envelope,
      apiToken: 'token',
      environment: 'main',
      options: {
        strictMode: true,
        skipWorkflowImport: true,
        skipRoleImport: true,
        skipModelFilterImport: true,
        skipMenuItemImport: true,
        skipSchemaMenuItemImport: true,
        resumeFromCheckpoint: false,
        publishAfterImport: false,
      },
    });

    expect(report.ok).toBe(true);
    expect(mock.workflowsCreate).not.toHaveBeenCalled();
    expect(mock.workflowsUpdate).not.toHaveBeenCalled();
    expect(mock.rolesList).not.toHaveBeenCalled();
    expect(mock.rolesCreate).not.toHaveBeenCalled();
    expect(mock.rolesUpdate).not.toHaveBeenCalled();
    expect(mock.itemTypeFiltersCreate).not.toHaveBeenCalled();
    expect(mock.itemTypeFiltersUpdate).not.toHaveBeenCalled();
    expect(mock.menuItemsList).not.toHaveBeenCalled();
    expect(mock.menuItemsCreate).not.toHaveBeenCalled();
    expect(mock.menuItemsUpdate).not.toHaveBeenCalled();
    expect(mock.schemaMenuItemsList).not.toHaveBeenCalled();
    expect(mock.schemaMenuItemsCreate).not.toHaveBeenCalled();
    expect(mock.schemaMenuItemsUpdate).not.toHaveBeenCalled();
    expect(
      report.warnings.some((message) =>
        message.includes('Skipped workflow import phase by option'),
      ),
    ).toBe(true);
    expect(
      report.warnings.some((message) =>
        message.includes('Skipped role import phase by option'),
      ),
    ).toBe(true);
    expect(
      report.warnings.some((message) =>
        message.includes('Skipped model filter import phase by option'),
      ),
    ).toBe(true);
    expect(
      report.warnings.some((message) =>
        message.includes('Skipped menu item import phase by option'),
      ),
    ).toBe(true);
    expect(
      report.warnings.some((message) =>
        message.includes('Skipped schema menu item import phase by option'),
      ),
    ).toBe(true);
  });

  test('can skip scheduled actions, webhooks, and build triggers', async () => {
    const envelope = buildEnvelope({
      recordCount: 1,
      includeLinkField: false,
    });
    if (envelope.projectConfiguration) {
      envelope.projectConfiguration.scheduledPublications = [
        {
          itemId: 'record-0',
          itemTypeId: 'source_model_page',
          scheduledAt: '2026-03-01T10:00:00.000Z',
          currentVersion: null,
        },
      ];
      envelope.projectConfiguration.scheduledUnpublishings = [
        {
          itemId: 'record-0',
          itemTypeId: 'source_model_page',
          scheduledAt: '2026-03-03T10:00:00.000Z',
          currentVersion: null,
        },
      ];
      envelope.projectConfiguration.webhooks = [
        {
          id: 'wh-1',
          name: 'Main Webhook',
          url: 'https://example.com/hook',
          events: ['create'],
        } as any,
      ];
      envelope.projectConfiguration.buildTriggers = [
        {
          id: 'bt-1',
          name: 'Main Trigger',
          adapter: 'custom',
          enabled: true,
        } as any,
      ];
    }

    const mock = createMockClient({ includeLinkField: false });
    buildClientMock.mockResolvedValue(mock.client);

    const report = await executeImportFromEnvelope({
      envelopeRaw: envelope,
      apiToken: 'token',
      environment: 'main',
      options: {
        strictMode: true,
        skipScheduledActionsImport: true,
        skipWebhookImport: true,
        skipBuildTriggerImport: true,
        resumeFromCheckpoint: false,
        publishAfterImport: false,
      },
    });

    expect(report.ok).toBe(true);
    expect(mock.scheduledPublicationCreate).not.toHaveBeenCalled();
    expect(mock.scheduledPublicationDestroy).not.toHaveBeenCalled();
    expect(mock.scheduledUnpublishingCreate).not.toHaveBeenCalled();
    expect(mock.scheduledUnpublishingDestroy).not.toHaveBeenCalled();
    expect(mock.webhooksList).not.toHaveBeenCalled();
    expect(mock.webhooksCreate).not.toHaveBeenCalled();
    expect(mock.webhooksUpdate).not.toHaveBeenCalled();
    expect(mock.buildTriggersList).not.toHaveBeenCalled();
    expect(mock.buildTriggersCreate).not.toHaveBeenCalled();
    expect(mock.buildTriggersUpdate).not.toHaveBeenCalled();
    expect(
      report.warnings.some((message) =>
        message.includes('Skipped scheduled actions replay by option'),
      ),
    ).toBe(true);
    expect(
      report.warnings.some((message) =>
        message.includes('Skipped webhook import phase by option'),
      ),
    ).toBe(true);
    expect(
      report.warnings.some((message) =>
        message.includes('Skipped build trigger import phase by option'),
      ),
    ).toBe(true);
  });
});
