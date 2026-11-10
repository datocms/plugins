import { describe, expect, it } from 'vitest';
import type { RawField } from '../presentation/fields';
import type { RawItemType } from '../types';
import {
  cmaFieldFilters,
  filterFieldsFor,
  hasStatusFilter,
  isMetaFilter,
  parseFilterConditions,
  serializeFilterConditions,
} from './filters';

function field(
  apiKey: string,
  fieldType: string,
  position: number,
  localized = false,
): RawField {
  return {
    id: apiKey,
    type: 'field',
    attributes: {
      api_key: apiKey,
      label: apiKey.toUpperCase(),
      field_type: fieldType,
      position,
      localized,
    },
  } as unknown as RawField;
}

const itemType = (attributes: { tree?: boolean; sortable?: boolean }) =>
  ({
    id: 'article',
    type: 'item_type',
    attributes: { tree: false, sortable: false, ...attributes },
  }) as unknown as RawItemType;

describe('filter fields', () => {
  it('lists the filters of every record, in the order of the dashboard', () => {
    const fields = filterFieldsFor({
      itemType: null,
      fields: [],
      filterLocale: 'en',
    });
    expect(fields.map((entry) => entry.label)).toEqual([
      'ID',
      'Updated at',
      'Created at',
      'Last published at',
      'First published at',
      'Scheduled publishing at',
      'Scheduled unpublishing at',
      'Status',
      'Is valid',
      'Creator',
      'Locales',
    ]);
  });

  it('adds the fields of the model, by position, with their locale', () => {
    const fields = filterFieldsFor({
      itemType: itemType({ tree: true }),
      fields: [
        field('body', 'structured_text', 2, true),
        field('title', 'string', 1),
        field('unknown', 'rich_text', 0),
      ],
      filterLocale: 'it',
    });
    expect(fields.slice(11).map((entry) => entry.label)).toEqual([
      'Parent',
      'Position',
      'TITLE',
      'BODY (Italian)',
    ]);
    // "is not null" says the same as "is present": the dashboard hides it
    expect(Object.keys(fields[13]?.operators ?? {})).not.toContain('exists');
    expect(Object.keys(fields[13]?.operators ?? {})).toContain('matches');
  });

  it('knows the filters that stay when the model changes', () => {
    expect(isMetaFilter('_status')).toBe(true);
    expect(isMetaFilter('id')).toBe(true);
    expect(isMetaFilter('title')).toBe(false);
  });
});

describe('filter conditions', () => {
  it('merges the tiles of a field and skips the empty ones', () => {
    expect(
      cmaFieldFilters([
        { field: '_updated_at', operator: 'gt', value: '2026-01-01' },
        { field: '_updated_at', operator: 'lt', value: '2026-02-01' },
        { field: 'title', operator: 'matches', value: { pattern: 'news' } },
        { field: 'id', operator: 'eq', value: null },
      ]),
    ).toEqual({
      _updated_at: { gt: '2026-01-01', lt: '2026-02-01' },
      title: { matches: { pattern: 'news' } },
    });
  });

  it('round-trips the tiles through the URL and drops malformed ones', () => {
    const conditions = [
      { field: '_status', operator: 'in', value: ['draft', 'updated'] },
      { field: 'id', operator: 'eq', value: null },
    ];
    expect(
      parseFilterConditions(serializeFilterConditions(conditions)),
    ).toEqual(conditions);
    expect(
      parseFilterConditions(
        JSON.stringify([
          ['ti tle', 'eq', 'x'],
          ['title', 'eq', { 'bad key': 1 }],
          ['title', 'eq'],
          ['title', 'eq', 'ok'],
        ]),
      ),
    ).toEqual([{ field: 'title', operator: 'eq', value: 'ok' }]);
    expect(parseFilterConditions('not json')).toEqual([]);
    expect(serializeFilterConditions([])).toBeNull();
  });

  it('knows when the status of the rows is filtered', () => {
    expect(
      hasStatusFilter([{ field: '_status', operator: 'eq', value: null }]),
    ).toBe(false);
    expect(
      hasStatusFilter([{ field: '_status', operator: 'neq', value: 'draft' }]),
    ).toBe(true);
  });
});
