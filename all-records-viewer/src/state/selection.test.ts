import { describe, expect, it } from 'vitest';
import type { RawItem } from '../types';
import {
  compactSelectedItem,
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
  it('retains permission and workflow metadata without record content or extra payloads', () => {
    const original = {
      ...item('complex-record'),
      attributes: {
        title: { en: 'English title', pt: 'Título' },
        blocks: [{ id: 'nested-block', content: 'large block content' }],
        references: ['referenced-record'],
      },
      meta: { stage: 'review', status: 'draft', current_version: 'version-1' },
      relationships: {
        item_type: { data: { id: 'model-1', type: 'item_type' } },
        creator: { data: { id: 'creator-1', type: 'user' } },
        unexpected: { data: { payload: 'large relationship payload' } },
      },
      included: ['large included content'],
    } as unknown as RawItem;

    const compact = compactSelectedItem(original);
    expect(compact).toEqual({
      id: 'complex-record',
      type: 'item',
      attributes: {},
      meta: { stage: 'review', status: 'draft', current_version: 'version-1' },
      relationships: {
        item_type: { data: { id: 'model-1', type: 'item_type' } },
        creator: { data: { id: 'creator-1', type: 'user' } },
      },
    });
    expect(compact).not.toBe(original);
    expect(compact.meta).not.toBe(original.meta);
    expect(compact.relationships.item_type).not.toBe(
      original.relationships.item_type,
    );
    expect(compact.relationships.creator).not.toBe(
      original.relationships.creator,
    );
    expect(original.attributes).toHaveProperty('blocks');
  });

  it('compacts records selected through either page-selection helper', () => {
    const full = {
      ...item('large-record'),
      attributes: { title: 'retained only in the displayed page' },
    } as RawItem;

    expect(
      setPageSelection(new Map(), [full], true).get(full.id)?.attributes,
    ).toEqual({});
    expect(
      invertPageSelection(new Map(), [full]).get(full.id)?.attributes,
    ).toEqual({});
  });

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

  it('preserves the map identity when every model remains available', () => {
    const valid = item('valid', 'model-1');
    const current = new Map([[valid.id, valid]]);
    expect(retainSelectionForModels(current, new Set(['model-1']))).toBe(
      current,
    );
  });
});
