import { describe, expect, it } from 'vitest';
import type { RawItem } from '../types';
import {
  invertPageSelection,
  retainSelectionForModels,
  setPageSelection,
} from './selection';

function item(id: string, modelId = 'model-1'): RawItem {
  return {
    id,
    type: 'item',
    attributes: {},
    relationships: {
      item_type: { data: { id: modelId, type: 'item_type' } },
    },
    meta: {},
  } as unknown as RawItem;
}

describe('page selection', () => {
  it('selects and deselects only the current page', () => {
    const offPage = item('off-page');
    const pageItem = item('on-page');
    const current = new Map([[offPage.id, offPage]]);

    const selected = setPageSelection(current, [pageItem], true);
    expect([...selected.keys()]).toEqual(['off-page', 'on-page']);
    expect([...setPageSelection(selected, [pageItem], false).keys()]).toEqual([
      'off-page',
    ]);
  });

  it('inverts current-page records without losing off-page records', () => {
    const offPage = item('off-page');
    const selectedOnPage = item('selected-on-page');
    const unselectedOnPage = item('unselected-on-page');
    const current = new Map([
      [offPage.id, offPage],
      [selectedOnPage.id, selectedOnPage],
    ]);

    expect([
      ...invertPageSelection(current, [
        selectedOnPage,
        unselectedOnPage,
      ]).keys(),
    ]).toEqual(['off-page', 'unselected-on-page']);
  });

  it('drops records whose model disappeared from the environment', () => {
    const valid = item('valid', 'model-1');
    const deletedModel = item('deleted-model', 'model-2');
    const current = new Map([
      [valid.id, valid],
      [deletedModel.id, deletedModel],
    ]);

    expect([
      ...retainSelectionForModels(current, new Set(['model-1'])).keys(),
    ]).toEqual(['valid']);
  });
});
