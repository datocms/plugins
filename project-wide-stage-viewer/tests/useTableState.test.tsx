import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useTableState } from '../src/data/useTableState';
import {
  buildModelPresentation,
  buildRow,
  type RecordRow,
} from '../src/lib/records';
import { buildItem, buildItemType } from './fixtures';

function row(id: string, modelId: string): RecordRow {
  return buildRow(
    buildItem(id, {}),
    buildModelPresentation(buildItemType(modelId, modelId), []),
    { locales: ['en'] },
  );
}

const rows = [row('a', 'm1'), row('b', 'm2')];
const selection = { ids: new Set<string>(), showing: false, hide: () => {} };

describe('useTableState', () => {
  it('lets "All models" clear a model filter whose model left the workflow', () => {
    const { result, rerender } = renderHook(
      ({ modelIds }) => useTableState(rows, modelIds, selection),
      { initialProps: { modelIds: ['m1', 'm2'] } },
    );
    act(() => result.current.setModelId('m1'));
    expect(result.current.matchingRows).toHaveLength(1);

    // The model leaves the workflow: its filter no longer applies.
    rerender({ modelIds: ['m2'] });
    expect(result.current.modelId).toBeNull();
    expect(result.current.matchingRows).toHaveLength(2);

    // Picking "All models" clears it for good, even if the model comes back.
    act(() => result.current.setModelId(null));
    rerender({ modelIds: ['m1', 'm2'] });
    expect(result.current.modelId).toBeNull();
    expect(result.current.matchingRows).toHaveLength(2);
  });

  it('keeps a filtered column unsortable in the selection view too', () => {
    const { result, rerender } = renderHook(
      ({ showing }) =>
        useTableState(rows, ['m1', 'm2'], {
          ids: new Set(['a', 'b']),
          showing,
          hide: () => {},
        }),
      { initialProps: { showing: false } },
    );
    act(() => result.current.setStatus('draft'));
    rerender({ showing: true });

    expect(result.current.sortableColumnIds?.has('_status')).toBe(false);
    expect(result.current.sortableColumnIds?.has('_model')).toBe(true);
  });
});
