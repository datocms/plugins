import { useCallback, useMemo, useState } from 'react';
import { SEARCH_DEBOUNCE_MS } from '../../constants';
import {
  applicableFilters,
  type CollectionControls,
  canSearchSkus,
  collectionControls,
  type EffectiveSearch,
  EMPTY_FILTERS,
  effectiveSearch,
  hasActiveFilters,
  isSkuCandidate,
  type PickerFilters,
} from '../../lib/pickerSearch';
import {
  type CollectionFilterSupport,
  defaultSort,
  type PickerSort,
  resolveSort,
  type SortContext,
} from '../../lib/queryString';
import type { FieldScope, ShopifyKind } from '../../types';
import useDebouncedValue from '../shared/useDebouncedValue';
import { useCollectionSupport } from './usePickerData';

export type PickerSearch = {
  text: string;
  setText: (text: string) => void;
  /** Debounced and trimmed. */
  debouncedText: string;
  filters: PickerFilters;
  setFilters: (update: (current: PickerFilters) => PickerFilters) => void;
  clearFilters: () => void;
  filtersActive: boolean;
  search: EffectiveSearch;
  controls: CollectionControls;
  inCollection: boolean;
  sortContext: SortContext;
  sort: PickerSort;
  skuText: string | null;
  /** Which Search & Discovery filters the browsed collection enabled, once known. */
  support: CollectionFilterSupport | null;
  rememberSupport: (
    collectionId: string,
    support: CollectionFilterSupport,
  ) => void;
};

/** Search text, the editor's filters and what they add up to with the scope. */
export function usePickerSearch(
  kind: ShopifyKind,
  scope: FieldScope | undefined,
): PickerSearch {
  const [text, setText] = useState('');
  const debouncedText = useDebouncedValue(text.trim(), SEARCH_DEBOUNCE_MS);
  const [filters, setFilterState] = useState<PickerFilters>(EMPTY_FILTERS);
  const debouncedVendor = useDebouncedValue(filters.vendor, SEARCH_DEBOUNCE_MS);
  const { supportById, remember } = useCollectionSupport();

  const collectionId = scope?.collectionId ?? filters.collection?.id ?? null;
  const inCollection = kind !== 'collection' && collectionId !== null;
  const support = collectionId ? (supportById[collectionId] ?? null) : null;
  const controls = useMemo(
    () => collectionControls(inCollection, support),
    [inCollection, support],
  );

  const search = useMemo(
    () =>
      effectiveSearch(
        scope,
        applicableFilters({ ...filters, vendor: debouncedVendor }, controls),
      ),
    [scope, filters, debouncedVendor, controls],
  );

  const sortContext = useMemo<SortContext>(
    () => ({ inCollection, hasText: !inCollection && debouncedText !== '' }),
    [inCollection, debouncedText],
  );
  const sort = resolveSort(
    filters.sort ?? defaultSort(sortContext),
    sortContext,
  );

  const setFilters = useCallback(
    (update: (current: PickerFilters) => PickerFilters) =>
      setFilterState(update),
    [],
  );
  const clearFilters = useCallback(
    () =>
      setFilterState((current) => ({ ...EMPTY_FILTERS, sort: current.sort })),
    [],
  );

  const skuText =
    kind !== 'collection' &&
    canSearchSkus(search) &&
    isSkuCandidate(debouncedText)
      ? debouncedText
      : null;

  return {
    text,
    setText,
    debouncedText,
    filters,
    setFilters,
    clearFilters,
    filtersActive: hasActiveFilters(filters),
    search,
    controls,
    inCollection,
    sortContext,
    sort,
    skuText,
    support,
    rememberSupport: remember,
  };
}
