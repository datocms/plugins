import { describe, expect, it, vi } from 'vitest';
import {
  columnSettingsStorageKey,
  DEFAULT_COLUMN_SETTINGS,
  loadColumnSettings,
  MIN_COLUMN_WIDTH,
  normalizeColumnSettings,
  reorderColumn,
  resizeAdjacentColumns,
  saveColumnSettings,
  toggleColumn,
} from './columnSettings';

describe('column settings', () => {
  it('uses the CMS-compatible default widths', () => {
    expect(DEFAULT_COLUMN_SETTINGS).toEqual([
      { id: '_preview', width: 0.45 },
      { id: '_model', width: 0.2 },
      { id: '_status', width: 0.15 },
      { id: '_updated_at', width: 0.2 },
    ]);
  });

  it('normalizes widths and removes duplicate or unknown columns', () => {
    expect(
      normalizeColumnSettings([
        { id: '_preview', width: 3 },
        { id: '_preview', width: 2 },
        { id: '_model', width: 1 },
        { id: 'unknown', width: 1 },
      ]),
    ).toEqual([
      { id: '_preview', width: 0.75 },
      { id: '_model', width: 0.25 },
    ]);
  });

  it('never removes the final visible column', () => {
    expect(toggleColumn([{ id: 'id', width: 1 }], 'id')).toEqual([
      { id: 'id', width: 1 },
    ]);
  });

  it('adds a column at 15% and redistributes a removed width', () => {
    const added = toggleColumn(
      [
        { id: '_preview', width: 0.5 },
        { id: '_model', width: 0.5 },
      ],
      'id',
    );
    expect(added).toEqual([
      { id: '_preview', width: 0.425 },
      { id: '_model', width: 0.425 },
      { id: 'id', width: 0.15 },
    ]);
    expect(toggleColumn(added, 'id')).toEqual([
      { id: '_preview', width: 0.5 },
      { id: '_model', width: 0.5 },
    ]);
  });

  it('keeps every existing column at or above 5% when adding one', () => {
    const added = toggleColumn(
      [
        { id: '_preview', width: 0.8 },
        { id: '_model', width: 0.05 },
        { id: '_status', width: 0.05 },
        { id: '_updated_at', width: 0.05 },
        { id: '_created_at', width: 0.05 },
      ],
      'id',
    );

    expect(added.every((column) => column.width >= MIN_COLUMN_WIDTH)).toBe(
      true,
    );
    expect(
      added.reduce((total, column) => total + column.width, 0),
    ).toBeCloseTo(1);
  });

  it('reorders without changing widths', () => {
    expect(
      reorderColumn(
        [
          { id: '_preview', width: 0.7 },
          { id: '_model', width: 0.3 },
        ],
        '_model',
        '_preview',
      ),
    ).toEqual([
      { id: '_model', width: 0.3 },
      { id: '_preview', width: 0.7 },
    ]);
  });

  it('resizes only an adjacent pair and enforces the 5% minimum', () => {
    const columns = [
      { id: '_preview' as const, width: 0.7 },
      { id: '_model' as const, width: 0.3 },
    ];
    const resized = resizeAdjacentColumns(columns, 0, 0.1);
    expect(resized.map((column) => column.id)).toEqual(['_preview', '_model']);
    expect(resized[0].width).toBeCloseTo(0.8);
    expect(resized[1].width).toBeCloseTo(0.2);
    const clamped = resizeAdjacentColumns(columns, 0, 0.26);
    expect(clamped[0].width).toBeCloseTo(0.95);
    expect(clamped[1].width).toBeCloseTo(0.05);
  });

  it('uses a site/environment/user-specific storage key', () => {
    expect(
      columnSettingsStorageKey({
        siteId: 'site',
        environment: 'sandbox',
        userId: 'user',
      }),
    ).toBe('datocms-all-records:site:sandbox:user:columns');
  });

  it('round trips valid settings and falls back on invalid JSON', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    };
    const columns = [
      { id: '_preview' as const, width: 0.6 },
      { id: 'id' as const, width: 0.4 },
    ];
    saveColumnSettings(storage, 'key', columns);
    expect(loadColumnSettings(storage, 'key')).toEqual(columns);
    values.set('broken', '{');
    expect(loadColumnSettings(storage, 'broken')).toEqual(
      DEFAULT_COLUMN_SETTINGS,
    );
  });
});
