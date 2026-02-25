/// <reference types="vitest" />

import { describe, expect, test } from 'vitest';
import {
  buildFieldSummaryIndex,
  rewriteRecordForImport,
  sanitizeRecordForUpdate,
} from './rewrite';
import type { IdMaps, JsonObject, SchemaFieldSummary } from './types';

function createIdMaps(): IdMaps {
  return {
    recordIds: new Map([
      ['record-a', 'target-a'],
      ['record-b', 'target-b'],
      ['record-c', 'target-c'],
    ]),
    uploadIds: new Map([
      ['upload-1', 'target-upload-1'],
      ['upload-2', 'target-upload-2'],
    ]),
    blockIds: new Map([
      ['block-1', 'target-block-1'],
      ['block-2', 'target-block-2'],
    ]),
  };
}

function createFieldIndex() {
  const fieldsByItemType: Record<string, SchemaFieldSummary[]> = {
    model_page: [
      {
        fieldId: 'f_related',
        apiKey: 'related',
        fieldType: 'link',
        localized: false,
      },
      {
        fieldId: 'f_content',
        apiKey: 'content',
        fieldType: 'structured_text',
        localized: false,
      },
      {
        fieldId: 'f_cover',
        apiKey: 'cover',
        fieldType: 'file',
        localized: false,
      },
      {
        fieldId: 'f_gallery',
        apiKey: 'gallery',
        fieldType: 'gallery',
        localized: false,
      },
      {
        fieldId: 'f_blocks',
        apiKey: 'body',
        fieldType: 'modular_content',
        localized: false,
      },
    ],
    block_hero: [
      {
        fieldId: 'f_target',
        apiKey: 'target',
        fieldType: 'link',
        localized: false,
      },
    ],
  };

  return buildFieldSummaryIndex(fieldsByItemType);
}

describe('rewriteRecordForImport', () => {
  test('rewrites circular record links when map is available', () => {
    const record: JsonObject = {
      id: 'record-a',
      item_type: { id: 'model_page' },
      related: 'record-b',
    };

    const { rewrittenRecord, unresolved } = rewriteRecordForImport(
      record,
      createFieldIndex(),
      createIdMaps(),
    );

    expect(rewrittenRecord.related).toBe('target-b');
    expect(unresolved).toEqual([]);
  });

  test('rewrites fields even when item_type is remapped', () => {
    const record: JsonObject = {
      id: 'record-a',
      item_type: { id: 'model_page' },
      related: 'record-b',
    };

    const { rewrittenRecord, unresolved } = rewriteRecordForImport(
      record,
      createFieldIndex(),
      createIdMaps(),
      {
        itemTypeIdMap: new Map([['model_page', 'target_model_page']]),
      },
    );

    expect(rewrittenRecord.item_type).toEqual({ id: 'target_model_page' });
    expect(rewrittenRecord.related).toBe('target-b');
    expect(unresolved).toEqual([]);
  });

  test('rewrites structured text links and blocks', () => {
    const record: JsonObject = {
      id: 'record-a',
      item_type: { id: 'model_page' },
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
                { type: 'itemLink', item: 'record-c' },
                { type: 'block', item: 'block-2' },
              ],
            },
          ],
        },
      },
    };

    const { rewrittenRecord, unresolved } = rewriteRecordForImport(
      record,
      createFieldIndex(),
      createIdMaps(),
    );

    const content = rewrittenRecord.content as JsonObject;
    expect(content.links).toEqual(['target-b']);
    expect(content.blocks).toEqual(['target-block-1']);

    const document = content.document as JsonObject;
    const paragraph = (document.children as JsonObject[])[0];
    const children = paragraph.children as JsonObject[];

    expect(children[0].item).toBe('target-c');
    expect(children[1].item).toBe('target-block-2');
    expect(unresolved).toEqual([]);
  });

  test('reports unresolved upload mapping entries', () => {
    const ids = createIdMaps();
    ids.uploadIds.delete('upload-2');

    const record: JsonObject = {
      id: 'record-a',
      item_type: { id: 'model_page' },
      cover: 'upload-1',
      gallery: ['upload-2'],
    };

    const { rewrittenRecord, unresolved } = rewriteRecordForImport(
      record,
      createFieldIndex(),
      ids,
    );

    expect(rewrittenRecord.cover).toBe('target-upload-1');
    expect(rewrittenRecord.gallery).toEqual(['upload-2']);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]).toMatchObject({ kind: 'upload', sourceId: 'upload-2' });
  });

  test('blanks asset fields when skipAssetFields is enabled', () => {
    const ids = createIdMaps();
    ids.uploadIds.clear();

    const record: JsonObject = {
      id: 'record-a',
      item_type: { id: 'model_page' },
      cover: 'upload-1',
      gallery: ['upload-2'],
    };

    const { rewrittenRecord, unresolved } = rewriteRecordForImport(
      record,
      createFieldIndex(),
      ids,
      {
        skipAssetFields: true,
      },
    );

    expect(rewrittenRecord.cover).toBeNull();
    expect(rewrittenRecord.gallery).toEqual([]);
    expect(unresolved).toEqual([]);
  });

  test('sanitizes system record keys from patch payload', () => {
    const payload = sanitizeRecordForUpdate({
      id: 'record-a',
      item_type: { id: 'model_page' },
      meta: { current_version: '1' },
      title: 'Hello',
      related: 'target-b',
    });

    expect(payload).toEqual({
      title: 'Hello',
      related: 'target-b',
    });
  });
});
