import { describe, expect, it, vi } from 'vitest';
import {
  columnSettingsStorageKey,
  DEFAULT_COLUMN_SETTINGS,
  fromTableLayout,
  loadColumnSettings,
  MIN_COLUMN_WIDTH,
  normalizeColumnSettings,
  saveColumnSettings,
  toTableLayout,
} from './columnSettings';

describe('column settings', () => {
  it('uses default widths where the status and the date fit', () => {
    expect(DEFAULT_COLUMN_SETTINGS).toEqual([
      { id: '_preview', width: 0.4 },
      { id: '_model', width: 0.15 },
      { id: '_status', width: 0.2 },
      { id: '_updated_at', width: 0.25 },
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

  it('converts the stored setting to the table layout and back', () => {
    const columns = [
      { id: '_preview' as const, width: 0.6 },
      { id: 'id' as const, width: 0.4 },
    ];
    const layout = toTableLayout(columns);
    expect(layout).toEqual({
      columns: [
        { name: '_preview', width: 0.6 },
        { name: 'id', width: 0.4 },
      ],
    });
    expect(fromTableLayout(layout)).toEqual(columns);
  });

  it('keeps every column at the minimum width when the table adds one', () => {
    // The table shrinks the shown columns by 0.85 and adds one at 0.15
    const columns = fromTableLayout({
      columns: [
        { name: '_preview', width: 0.8 * 0.85 },
        { name: '_model', width: 0.05 * 0.85 },
        { name: '_status', width: 0.05 * 0.85 },
        { name: '_updated_at', width: 0.05 * 0.85 },
        { name: '_created_at', width: 0.05 * 0.85 },
        { name: 'id', width: 0.15 },
      ],
    });

    expect(columns.map((column) => column.id)).toEqual([
      '_preview',
      '_model',
      '_status',
      '_updated_at',
      '_created_at',
      'id',
    ]);
    expect(columns.every((column) => column.width >= MIN_COLUMN_WIDTH)).toBe(
      true,
    );
    expect(
      columns.reduce((total, column) => total + column.width, 0),
    ).toBeCloseTo(1);
    // The stored setting keeps the layout instead of resetting it
    expect(normalizeColumnSettings(columns).map((column) => column.id)).toEqual(
      columns.map((column) => column.id),
    );
  });

  it('drops unknown and duplicate columns of the table layout', () => {
    expect(
      fromTableLayout({
        columns: [
          { name: '_model', width: 1 },
          { name: 'unknown', width: 1 },
          { name: '_model', width: 2 },
          { name: '_status', width: 3 },
        ],
      }),
    ).toEqual([
      { id: '_model', width: 0.25 },
      { id: '_status', width: 0.75 },
    ]);
    expect(
      fromTableLayout({ columns: [{ name: 'unknown', width: 1 }] }),
    ).toEqual(DEFAULT_COLUMN_SETTINGS);
  });

  it('uses a site/environment/user-specific storage key', () => {
    expect(
      columnSettingsStorageKey({
        siteId: 'site',
        environment: 'sandbox',
        userId: 'user',
      }),
    ).toBe('datocms-stage-viewer:site:sandbox:user:columns');
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
