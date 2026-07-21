import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ColumnSetting } from '../types';
import { useColumnSettings } from './useColumnSettings';

const MAIN_COLUMNS: ColumnSetting[] = [{ id: '_preview', width: 1 }];
const SANDBOX_COLUMNS: ColumnSetting[] = [{ id: 'id', width: 1 }];

afterEach(() => {
  window.localStorage.clear();
});

describe('useColumnSettings', () => {
  it('loads the independent setting when the environment key changes', async () => {
    window.localStorage.setItem('main', JSON.stringify(MAIN_COLUMNS));
    window.localStorage.setItem('sandbox', JSON.stringify(SANDBOX_COLUMNS));

    const { result, rerender } = renderHook(
      ({ storageKey }) => useColumnSettings(storageKey),
      { initialProps: { storageKey: 'main' } },
    );

    expect(result.current[0]).toEqual(MAIN_COLUMNS);
    rerender({ storageKey: 'sandbox' });

    await waitFor(() => expect(result.current[0]).toEqual(SANDBOX_COLUMNS));

    act(() => {
      result.current[1](MAIN_COLUMNS);
    });
    expect(
      JSON.parse(window.localStorage.getItem('sandbox') ?? 'null'),
    ).toEqual(MAIN_COLUMNS);
  });
});
