/// <reference types="vitest" />

import {
  buildRecordExportEnvelope,
  type SiteManifestInfo,
} from './recordExport';

const siteInfo: SiteManifestInfo = {
  sourceProjectId: 'project-1',
  sourceEnvironment: 'main',
  defaultLocale: 'en',
  locales: ['en', 'pt'],
};

describe('recordExport envelope', () => {
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
