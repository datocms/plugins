import { describe, expect, it } from 'vitest';
import {
  buildRow,
  DEFAULT_ORDER_BY,
  filterRows,
  type RecordRow,
  sortRows,
  withPresentation,
} from '../src/lib/records';
import { buildItem, buildItemType } from './fixtures';

describe('buildRow', () => {
  it('names the record by ID until the host presents it', () => {
    const row = buildRow(buildItem('r42', {}), buildItemType('m1', 'Page'));
    expect(row).toMatchObject({ title: 'Record #r42', modelName: 'Page' });
    expect(row.presentation).toMatchObject({
      id: 'r42',
      title: 'Record #r42',
      image: null,
      itemTypeId: 'm1',
    });
  });

  it('reads the status from the record, defaulting to published', () => {
    const itemType = buildItemType('a', 'A');
    expect(
      buildRow(buildItem('r1', {}, { status: 'updated' }), itemType).status,
    ).toBe('updated');
    expect(
      buildRow(buildItem('r2', {}, { status: null }), itemType).status,
    ).toBe('published');
  });

  it('keeps both validity flags and a compact record for permission checks', () => {
    const row = buildRow(
      buildItem(
        'r1',
        { title: 'A long body that selection never needs' },
        { is_current_version_valid: false, is_published_version_valid: true },
      ),
      buildItemType('a', 'A'),
    );
    expect(row.presentation).toMatchObject({
      currentVersionValid: false,
      publishedVersionValid: true,
    });
    expect(row.item.attributes).toEqual({});
    expect(row.item.meta.stage).toBe('review');
  });
});

describe('withPresentation', () => {
  it('gives the row the title, image and status that DatoCMS shows', () => {
    const presentation = {
      id: 'r1',
      title: 'Ciao',
      image: { type: 'image' as const, url: 'https://example.com/a.png' },
      itemTypeId: 'm1',
      status: 'draft' as const,
      currentVersionValid: true,
      publishedVersionValid: true,
      editPath: '/editor/item_types/m1/items/r1/edit',
    };
    const row = withPresentation(
      buildRow(buildItem('r1', {}), buildItemType('m1', 'Article')),
      presentation,
    );
    expect(row.title).toBe('Ciao');
    expect(row.presentation).toBe(presentation);
  });
});

function row(
  id: string,
  title: string,
  updatedAt: string,
  extra: Partial<RecordRow> = {},
): RecordRow {
  return {
    ...buildRow(
      buildItem(id, {}, { updated_at: updatedAt }),
      buildItemType('m1', 'Article'),
    ),
    title,
    ...extra,
  };
}

describe('sorting', () => {
  const rows = [
    row('1', 'Banana', '2026-01-02T00:00:00Z', { status: 'published' }),
    row('2', 'apple', '2026-01-03T00:00:00Z', { status: 'draft' }),
    row('3', 'Cherry', '2026-01-01T00:00:00Z', { status: 'updated' }),
  ];

  it('puts the most recently updated records first by default', () => {
    expect(sortRows(rows, DEFAULT_ORDER_BY).map(({ id }) => id)).toEqual([
      '2',
      '1',
      '3',
    ]);
  });

  it('sorts titles case-insensitively in both directions', () => {
    expect(sortRows(rows, '_preview_ASC').map(({ title }) => title)).toEqual([
      'apple',
      'Banana',
      'Cherry',
    ]);
    expect(sortRows(rows, '_preview_DESC').map(({ title }) => title)).toEqual([
      'Cherry',
      'Banana',
      'apple',
    ]);
  });

  it('orders statuses as the API does', () => {
    expect(sortRows(rows, '_status_ASC').map(({ status }) => status)).toEqual([
      'draft',
      'published',
      'updated',
    ]);
  });
});

describe('filterRows', () => {
  const rows = [
    row('a1', 'Café opening', '2026-01-01T00:00:00Z'),
    row('b2', 'Menu', '2026-01-01T00:00:00Z', {
      modelId: 'm2',
      modelName: 'Page',
      status: 'published',
    }),
  ];
  const none = { query: '', modelId: null, status: null };

  it('matches titles without accents or case', () => {
    expect(filterRows(rows, { ...none, query: 'CAFE' })).toHaveLength(1);
  });

  it('matches model names and IDs', () => {
    expect(filterRows(rows, { ...none, query: 'page' })[0].id).toBe('b2');
    expect(filterRows(rows, { ...none, query: 'a1' })[0].id).toBe('a1');
  });

  it('keeps only the chosen model and status', () => {
    expect(filterRows(rows, { ...none, modelId: 'm2' })).toHaveLength(1);
    expect(
      filterRows(rows, { ...none, status: 'published' }).map(({ id }) => id),
    ).toEqual(['b2']);
  });
});
