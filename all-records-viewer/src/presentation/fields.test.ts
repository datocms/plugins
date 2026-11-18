import { describe, expect, it } from 'vitest';
import type { RawItem, RawItemType } from '../types';
import { getPresentationTitleField, type RawField } from './fields';
import { getItemStatus } from './status';

function field(
  id: string,
  apiKey: string,
  fieldType: RawField['attributes']['field_type'],
  position: number,
  heading = false,
): RawField {
  return {
    id,
    type: 'field',
    attributes: {
      api_key: apiKey,
      field_type: fieldType,
      localized: false,
      position,
      appearance: { editor: 'single_line', parameters: { heading } },
    },
    relationships: {
      item_type: { data: { id: 'model-1', type: 'item_type' } },
    },
  } as unknown as RawField;
}

function itemType(titleFieldId: string | null = null): RawItemType {
  return {
    id: 'model-1',
    type: 'item_type',
    attributes: { name: 'Article', api_key: 'article' },
    relationships: {
      presentation_title_field: {
        data: titleFieldId ? { id: titleFieldId, type: 'field' } : null,
      },
    },
  } as unknown as RawItemType;
}

describe('presentation title field', () => {
  const plain = field('plain', 'plain', 'string', 0);
  const heading = field('heading', 'heading', 'string', 2, true);
  const configured = field('configured', 'configured', 'text', 10);

  it('uses the configured field before the native fallback precedence', () => {
    expect(
      getPresentationTitleField(itemType('configured'), [
        plain,
        heading,
        configured,
      ])?.id,
    ).toBe('configured');
    expect(getPresentationTitleField(itemType(), [plain, heading])?.id).toBe(
      'heading',
    );
  });

  it('keeps native position and API key precedence without sorting schema arrays', () => {
    const last = field('last', 'z', 'string', 1, true);
    const first = field('first', 'a', 'string', 1, true);
    const fields = [last, first, plain];
    expect(getPresentationTitleField(itemType(), fields)?.id).toBe('first');
    expect(fields).toEqual([last, first, plain]);
  });
});

describe('status', () => {
  it('reads a record with no status as published', () => {
    const record = { meta: { status: null } } as unknown as RawItem;
    expect(getItemStatus(record)).toBe('published');
  });
});
