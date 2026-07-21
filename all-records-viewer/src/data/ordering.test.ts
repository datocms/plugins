import { describe, expect, it } from 'vitest';
import type { RawField } from '../presentation/fields';
import type { RawItemType } from '../types';
import {
  previewOrderingField,
  serverOrderBy,
  sortableColumnIds,
} from './ordering';

function itemType(titleFieldId: string | null = null): RawItemType {
  return {
    id: 'model-1',
    type: 'item_type',
    attributes: {
      name: 'Article',
      api_key: 'article',
      modular_block: false,
      draft_mode_active: true,
    },
    relationships: {
      fields: { data: [] },
      presentation_title_field: {
        data: titleFieldId ? { id: titleFieldId, type: 'field' } : null,
      },
      presentation_image_field: { data: null },
      workflow: { data: null },
    },
  } as unknown as RawItemType;
}

function field(
  id: string,
  apiKey: string,
  fieldType: RawField['attributes']['field_type'],
): RawField {
  return {
    id,
    type: 'field',
    attributes: {
      api_key: apiKey,
      field_type: fieldType,
      localized: false,
      position: 0,
      appearance: { editor: 'single_line', parameters: {} },
    },
    relationships: {
      item_type: { data: { id: 'model-1', type: 'item_type' } },
    },
  } as unknown as RawField;
}

describe('server ordering', () => {
  it('maps model-scoped Preview sorting to the native title field', () => {
    const title = field('title-field', 'title', 'string');
    const model = itemType(title.id);

    expect(previewOrderingField(model, [title])).toBe(title);
    expect(
      serverOrderBy({
        orderBy: '_preview_ASC',
        itemType: model,
        fields: [title],
      }),
    ).toBe('title_ASC');
  });

  it('does not expose Preview sorting for an unsupported title field', () => {
    const title = field('title-field', 'title', 'structured_text');
    const model = itemType(title.id);

    expect(previewOrderingField(model, [title])).toBeNull();
    expect(
      sortableColumnIds({
        itemType: model,
        fields: [title],
        fieldsLoaded: true,
      }),
    ).not.toContain('_preview');
  });

  it('exposes global bucket sorts and model-scoped Preview', () => {
    const globalColumns = sortableColumnIds({
      itemType: null,
      fields: [],
      fieldsLoaded: true,
    });
    expect(globalColumns).toContain('_model');
    expect(globalColumns).toContain('_status');
    expect(globalColumns).not.toContain('_preview');
    expect(
      sortableColumnIds({
        itemType: itemType(),
        fields: [],
        fieldsLoaded: true,
      }),
    ).toContain('_status');
  });

  it('uses deterministic metadata ordering inside global buckets', () => {
    expect(
      serverOrderBy({ orderBy: '_model_ASC', itemType: null, fields: [] }),
    ).toBe('_updated_at_DESC,id_ASC');
    expect(
      serverOrderBy({ orderBy: '_status_DESC', itemType: null, fields: [] }),
    ).toBe('_updated_at_DESC,id_ASC');
  });

  it('adds a stable ID tiebreaker to cross-model metadata ordering', () => {
    expect(
      serverOrderBy({
        orderBy: '_updated_at_DESC',
        itemType: null,
        fields: [],
      }),
    ).toBe('_updated_at_DESC,id_ASC');
    expect(
      serverOrderBy({ orderBy: 'id_DESC', itemType: null, fields: [] }),
    ).toBe('id_DESC');
  });
});
