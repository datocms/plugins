import { describe, expect, it } from 'vitest';
import { builderConditionsOf, filterConditionsOf } from './builder';
import { filterFieldsFor } from './filters';
import { FILTER_SCHEMA } from './schema';
import type { FilterCondition, FilterField } from './types';

const FIELDS: FilterField[] = [
  ...filterFieldsFor({ itemType: null, fields: [], filterLocale: 'en' }),
  {
    key: 'title',
    label: 'Title',
    operators: FILTER_SCHEMA.fieldTypes.string,
  },
];

describe('filter builder conditions', () => {
  it('gives the builder the values of the URL as its editors take them', () => {
    expect(
      builderConditionsOf(
        [
          { field: '_status', operator: 'in', value: ['draft'] },
          { field: '_is_valid', operator: 'eq', value: false },
          { field: 'title', operator: 'matches', value: { pattern: 'news' } },
          { field: 'unknown', operator: 'eq', value: 'kept' },
        ],
        FIELDS,
      ),
    ).toEqual([
      { field: '_status', operator: 'in', value: ['draft'] },
      { field: '_is_valid', operator: 'eq', value: 'false' },
      { field: 'title', operator: 'matches', value: 'news' },
      { field: 'unknown', operator: 'eq', value: 'kept' },
    ]);
  });

  it('keeps the untouched conditions of the URL as they were', () => {
    const filters: FilterCondition[] = [
      {
        field: 'title',
        operator: 'matches',
        value: { pattern: 'news', case_sensitive: true },
      },
      { field: '_status', operator: 'eq', value: 'draft' },
    ];
    const builder = builderConditionsOf(filters, FIELDS);
    const next = [
      builder[0],
      { field: '_status', operator: 'eq', value: 'published' },
      { field: 'id', operator: 'in', value: ['1', ' 2 '] },
    ];

    expect(filterConditionsOf(next, { builder, filters }, FIELDS)).toEqual([
      filters[0],
      { field: '_status', operator: 'eq', value: 'published' },
      { field: 'id', operator: 'in', value: ['1', '2'] },
    ]);
  });

  it('keeps a condition with no value yet, with a null value', () => {
    expect(
      filterConditionsOf(
        [{ field: '_updated_at', operator: 'gt', value: null }],
        { builder: [], filters: [] },
        FIELDS,
      ),
    ).toEqual([{ field: '_updated_at', operator: 'gt', value: null }]);
  });
});
