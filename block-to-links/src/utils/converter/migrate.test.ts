import { describe, expect, it, vi } from 'vitest';
import type {
  CMAClient,
  ConversionRollbackAction,
  GroupedBlockInstance,
  NestedBlockPath,
} from '../../types';
import {
  migrateBlocksToRecordsNested,
  migrateFieldData,
  migrateFieldDataAppend,
  migrateGroupedBlocksToRecords,
  migrateNestedBlockFieldData,
} from './migrate';

const projectLocales = [
  'en',
  'de-DE',
  'fr-FR',
  'fr-BE',
  'it-IT',
  'nl-NL',
  'nl-BE',
  'de-AT',
  'de-CH',
  'en-CH',
  'it-CH',
  'fr-CH',
];

function groupedInstance(
  overrides: Partial<GroupedBlockInstance> = {},
): GroupedBlockInstance {
  return {
    groupKey: 'root-1_0',
    rootRecordId: 'root-1',
    pathIndices: [0],
    localeData: {
      en: {
        title: 'English',
        slides: [
          {
            type: 'item',
            id: 'slide-1',
            relationships: {
              item_type: {
                data: { type: 'item_type', id: 'slide-type' },
              },
            },
            attributes: {
              image: {
                upload_id: 'upload-1',
                alt: 'A descriptive alt',
                title: null,
                custom_data: { credit: 'Studio' },
                focal_point: { x: 0.5, y: 0.4 },
              },
            },
          },
        ],
      },
    },
    allBlockIds: ['source-block-1'],
    referenceBlockId: 'source-block-1',
    ...overrides,
  };
}

function clientWithItemMethods(methods: Record<string, unknown>): CMAClient {
  return {
    items: methods,
  } as unknown as CMAClient;
}

function block(id: string, itemTypeId: string): Record<string, unknown> {
  return {
    id,
    type: 'item',
    __itemTypeId: itemTypeId,
    relationships: {
      item_type: {
        data: { type: 'item_type', id: itemTypeId },
      },
    },
    attributes: {},
  };
}

describe('record creation preflight', () => {
  it('does not synthesize absent locales and preserves file metadata', async () => {
    const validatedRequests: Array<Record<string, unknown>> = [];
    const createdRequests: Array<Record<string, unknown>> = [];
    const client = clientWithItemMethods({
      validateNew: vi.fn(async (request: Record<string, unknown>) => {
        validatedRequests.push(request);
      }),
      create: vi.fn(async (request: Record<string, unknown>) => {
        createdRequests.push(request);
        return { id: 'record-1' };
      }),
    });

    await migrateGroupedBlocksToRecords(
      client,
      [groupedInstance()],
      'new-model',
      projectLocales,
      {},
      vi.fn(),
    );

    expect(validatedRequests).toHaveLength(1);
    expect(createdRequests).toEqual(validatedRequests);

    const request = createdRequests[0];
    const slides = request.slides as Record<string, unknown>;
    expect(Object.keys(slides)).toEqual(['en']);
    expect(slides).not.toHaveProperty('en-CH');
    expect(slides).not.toHaveProperty('it-CH');
    expect(slides).not.toHaveProperty('fr-CH');

    const serialized = JSON.stringify(slides.en);
    expect(serialized).toContain('A descriptive alt');
    expect(serialized).toContain('Studio');
    expect(serialized).toContain('"focal_point":{"x":0.5,"y":0.4}');
  });

  it('validates every payload before creating the first record', async () => {
    const events: string[] = [];
    const client = clientWithItemMethods({
      validateNew: vi.fn(async (request: Record<string, unknown>) => {
        const title = request.title as Record<string, string>;
        events.push(`validate:${title.en}`);
      }),
      create: vi.fn(async (request: Record<string, unknown>) => {
        const title = request.title as Record<string, string>;
        events.push(`create:${title.en}`);
        return { id: `record-${title.en}` };
      }),
    });

    await migrateGroupedBlocksToRecords(
      client,
      [
        groupedInstance(),
        groupedInstance({
          groupKey: 'root-2_0',
          rootRecordId: 'root-2',
          localeData: { en: { title: 'Second' } },
          allBlockIds: ['source-block-2'],
          referenceBlockId: 'source-block-2',
        }),
      ],
      'new-model',
      projectLocales,
      {},
      vi.fn(),
    );

    expect(events).toEqual([
      'validate:English',
      'validate:Second',
      'create:English',
      'create:Second',
    ]);
  });

  it('supports a validation-only pass with no record creation', async () => {
    const validateNew = vi.fn(async () => {});
    const create = vi.fn();
    const client = clientWithItemMethods({ validateNew, create });

    const mapping = await migrateGroupedBlocksToRecords(
      client,
      [groupedInstance()],
      'new-model',
      projectLocales,
      {},
      vi.fn(),
      { validateOnly: true },
    );

    expect(validateNew).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
    expect(mapping).toEqual({});
  });

  it('creates no records when preflight validation fails', async () => {
    const create = vi.fn();
    const client = clientWithItemMethods({
      validateNew: vi.fn(async () => {
        throw Object.assign(new Error('POST /items/validate: 422'), {
          errors: [
            {
              attributes: {
                code: 'INVALID_FIELD',
                details: {
                  field: 'slides.en-CH.0.image',
                  code: 'VALIDATION_REQUIRED_ALT_TITLE',
                  locale: 'en-CH',
                },
              },
            },
          ],
        });
      }),
      create,
    });

    await expect(
      migrateGroupedBlocksToRecords(
        client,
        [
          groupedInstance({
            rootRecordId: 'source-root-42',
            pathIndices: [3, 1],
          }),
        ],
        'new-model',
        projectLocales,
        {},
        vi.fn(),
      ),
    ).rejects.toThrow(
      /source record source-root-42, block position 3 → 1, source locales en.*Required alternate text is missing at slides\.en-CH\.0\.image \(locale en-CH\)/,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('keeps nonlocalized content shared when fields must be localized', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const nestedPath: NestedBlockPath = {
      rootModelId: 'root-model',
      rootModelName: 'Root',
      rootModelApiKey: 'roots',
      path: [
        {
          fieldApiKey: 'content',
          expectedBlockTypeId: 'target-type',
          localized: false,
          fieldType: 'rich_text',
        },
      ],
      fieldInfo: {
        id: 'field-1',
        label: 'Content',
        apiKey: 'content',
        parentModelId: 'root-model',
        parentModelName: 'Root',
        parentModelApiKey: 'roots',
        parentIsBlock: false,
        localized: false,
        allowedBlockIds: ['target-type'],
        fieldType: 'rich_text',
      },
      isInLocalizedContext: false,
    };
    const sourceBlock = {
      id: 'source-block-1',
      type: 'item',
      __itemTypeId: 'target-type',
      relationships: {
        item_type: {
          data: { type: 'item_type', id: 'target-type' },
        },
      },
      attributes: {
        title: 'Shared title',
        image: {
          upload_id: 'upload-1',
          alt: 'Shared alt',
        },
      },
    };
    const client = clientWithItemMethods({
      listPagedIterator: async function* () {
        yield {
          id: 'root-1',
          content: [sourceBlock],
        };
      },
      validateNew: vi.fn(async (request: Record<string, unknown>) => {
        requests.push(request);
      }),
      create: vi.fn(async () => ({ id: 'record-1' })),
    });

    await migrateBlocksToRecordsNested(
      client,
      nestedPath,
      'target-type',
      'new-model',
      {},
      vi.fn(),
      {
        forceLocalizedFields: true,
        availableLocales: projectLocales,
      },
    );

    expect(requests).toHaveLength(1);
    expect(requests[0].title).toEqual(
      Object.fromEntries(
        projectLocales.map((locale) => [locale, 'Shared title']),
      ),
    );
    expect(requests[0].image).toEqual(
      Object.fromEntries(
        projectLocales.map((locale) => [
          locale,
          {
            upload_id: 'upload-1',
            alt: 'Shared alt',
          },
        ]),
      ),
    );
  });
});

describe('nested record updates', () => {
  it('never round-trips stale attributes from other locales', async () => {
    const updates: Array<{
      id: string;
      body: Record<string, unknown>;
    }> = [];
    const targetBlock = {
      id: 'target-1',
      type: 'item',
      __itemTypeId: 'target-type',
      attributes: {},
    };
    const parentBlock = (
      id: string,
      oldLink: unknown,
    ): Record<string, unknown> => ({
      id,
      type: 'item',
      __itemTypeId: 'parent-type',
      relationships: {
        item_type: {
          data: { type: 'item_type', id: 'parent-type' },
        },
      },
      attributes: {
        heading: 'Unrelated',
        obsolete_schema_field: 'must not be submitted',
        link: oldLink,
      },
    });
    const nestedPath: NestedBlockPath = {
      rootModelId: 'root-model',
      rootModelName: 'Root',
      rootModelApiKey: 'roots',
      path: [
        {
          fieldApiKey: 'content',
          expectedBlockTypeId: 'parent-type',
          localized: true,
          fieldType: 'rich_text',
        },
        {
          fieldApiKey: 'link',
          expectedBlockTypeId: 'target-type',
          localized: false,
          fieldType: 'single_block',
        },
      ],
      fieldInfo: {
        id: 'link-field',
        label: 'Link',
        apiKey: 'link',
        parentModelId: 'parent-type',
        parentModelName: 'Parent',
        parentModelApiKey: 'parent',
        parentIsBlock: true,
        localized: false,
        allowedBlockIds: ['target-type'],
        fieldType: 'single_block',
      },
      isInLocalizedContext: true,
    };
    const client = clientWithItemMethods({
      listPagedIterator: async function* () {
        yield {
          id: 'root-1',
          content: {
            en: [parentBlock('parent-en', targetBlock)],
            'de-DE': [parentBlock('parent-de', null)],
          },
        };
      },
      update: vi.fn(
        async (id: string, body: Record<string, unknown>) => {
          updates.push({ id, body });
        },
      ),
    });

    await migrateNestedBlockFieldData(
      client,
      nestedPath,
      'link',
      'converted_link',
      'target-type',
      { 'target-1': 'record-1' },
      true,
      ['en', 'de-DE'],
    );

    expect(updates).toEqual([
      {
        id: 'root-1',
        body: {
          content: {
            en: [
              {
                type: 'item',
                id: 'parent-en',
                relationships: {
                  item_type: {
                    data: {
                      type: 'item_type',
                      id: 'parent-type',
                    },
                  },
                },
                attributes: {
                  converted_link: 'record-1',
                },
              },
            ],
            'de-DE': ['parent-de'],
          },
        },
      },
    ]);
    expect(JSON.stringify(updates)).not.toContain('obsolete_schema_field');
    expect(JSON.stringify(updates)).not.toContain('"link"');
  });
});

describe('links field updates', () => {
  it('skips localized records that contain no matching blocks', async () => {
    const update = vi.fn();
    const emptyLocalizedSource = Object.fromEntries(
      projectLocales.map((locale) => [
        locale,
        [block(`other-${locale}`, 'other-type')],
      ]),
    );
    const client = clientWithItemMethods({
      listPagedIterator: async function* () {
        yield {
          id: 'page-without-target',
          hero: emptyLocalizedSource,
        };
      },
      update,
    });

    await migrateFieldData(
      client,
      'page-model',
      'hero',
      'hero_links',
      true,
      'target-type',
      {},
      false,
    );

    expect(update).not.toHaveBeenCalled();
  });

  it('only appends new links and can restore the previous raw value', async () => {
    const rollbackActions: ConversionRollbackAction[] = [];
    const updates: Array<{
      id: string;
      body: Record<string, unknown>;
    }> = [];
    const rawRecords = [
      {
        id: 'page-without-target',
        hero_links: { en: [] },
      },
      {
        id: 'page-with-new-link',
        hero_links: { en: ['existing-record'] },
      },
      {
        id: 'page-with-existing-link',
        hero_links: { en: ['converted-record'] },
      },
    ];
    const nestedRecords: Record<string, Record<string, unknown>> = {
      'page-without-target': {
        id: 'page-without-target',
        hero: { en: [block('other-block', 'other-type')] },
      },
      'page-with-new-link': {
        id: 'page-with-new-link',
        hero: { en: [block('target-block', 'target-type')] },
      },
      'page-with-existing-link': {
        id: 'page-with-existing-link',
        hero: { en: [block('target-block', 'target-type')] },
      },
    };
    const client = clientWithItemMethods({
      listPagedIterator: async function* () {
        yield* rawRecords;
      },
      find: vi.fn(async (id: string) => nestedRecords[id]),
      update: vi.fn(
        async (id: string, body: Record<string, unknown>) => {
          updates.push({ id, body });
        },
      ),
    });

    await migrateFieldDataAppend(
      client,
      'page-model',
      'hero',
      'hero_links',
      true,
      'target-type',
      { 'target-block': 'converted-record' },
      undefined,
      rollbackActions,
    );

    expect(updates).toEqual([
      {
        id: 'page-with-new-link',
        body: {
          hero_links: {
            en: ['existing-record', 'converted-record'],
          },
        },
      },
    ]);
    expect(rollbackActions).toHaveLength(1);

    await rollbackActions[0].run();

    expect(updates[1]).toEqual({
      id: 'page-with-new-link',
      body: {
        hero_links: { en: ['existing-record'] },
      },
    });
  });
});
