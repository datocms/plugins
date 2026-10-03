import type { Client } from '@datocms/cma-client-browser';
import { compactSelectedItem } from '../state/selection';
import type { QueryState, RawItem } from '../types';
import {
  buildItemsListQuery,
  itemsPageTotal,
  normalizeQueryState,
  throwIfItemsRequestAborted,
  waitForItemsRequest,
} from './query';

const SELECTION_PAGE_SIZE = 200;
const CHANGED_SELECTION_MESSAGE =
  'Records changed while the selection was loading. Refresh the view and select the records again.';

type SelectionOptions = {
  modelIds?: readonly string[];
  signal?: AbortSignal;
  onProgress?: (selectedCount: number, totalCount: number) => void;
};

async function collectMatchingRecords(
  client: Pick<Client, 'items'>,
  queryState: QueryState,
  selected: Map<string, RawItem>,
  options: SelectionOptions,
  globalTotal?: number,
): Promise<void> {
  const query = buildItemsListQuery(queryState);
  let initialTotal: number | undefined;
  let offset = 0;

  do {
    throwIfItemsRequestAborted(options.signal);
    // biome-ignore lint/performance/noAwaitInLoops: Pages are read serially to bound memory and API concurrency.
    const response = await waitForItemsRequest(
      client.items.rawList({
        ...query,
        // A single model honors identity order even when searching its fields.
        order_by: 'id_ASC',
        page: { offset, limit: SELECTION_PAGE_SIZE },
      }),
      options.signal,
    );
    throwIfItemsRequestAborted(options.signal);
    const total = itemsPageTotal(response, offset, SELECTION_PAGE_SIZE);
    if (initialTotal === undefined) initialTotal = total;
    if (
      total !== initialTotal ||
      (globalTotal !== undefined &&
        selected.size + response.data.length > globalTotal)
    ) {
      throw new Error(CHANGED_SELECTION_MESSAGE);
    }

    for (const item of response.data) {
      if (
        selected.has(item.id) ||
        (queryState.model &&
          item.relationships.item_type.data.id !== queryState.model)
      ) {
        throw new Error(CHANGED_SELECTION_MESSAGE);
      }
      selected.set(item.id, compactSelectedItem(item));
    }

    // A short page is not proof that pagination has completed.
    offset += response.data.length;
    options.onProgress?.(selected.size, globalTotal ?? initialTotal);
  } while (offset < initialTotal);

  throwIfItemsRequestAborted(options.signal);
}

/** Collect matching identities without retaining large localized or nested fields. */
export async function collectSelection(
  client: Pick<Client, 'items'>,
  queryState: QueryState,
  options: SelectionOptions = {},
): Promise<ReadonlyMap<string, RawItem>> {
  const state = normalizeQueryState(queryState);
  const selected = new Map<string, RawItem>();
  if (!state.query || state.model) {
    await collectMatchingRecords(client, state, selected, options);
    return selected;
  }

  // All-model search ignores order_by and uses relevance. Partitioning by model
  // restores identity ordering without changing which records match the filter.
  if (!options.modelIds) {
    throw new RangeError(
      'Models are required to select records from an all-model search.',
    );
  }
  throwIfItemsRequestAborted(options.signal);
  const response = await waitForItemsRequest(
    client.items.rawList({
      ...buildItemsListQuery(state),
      page: { offset: 0, limit: 0 },
    }),
    options.signal,
  );
  throwIfItemsRequestAborted(options.signal);
  const globalTotal = itemsPageTotal(response, 0, 0);
  options.onProgress?.(0, globalTotal);

  for (const modelId of new Set(options.modelIds)) {
    if (globalTotal === 0) break;
    // biome-ignore lint/performance/noAwaitInLoops: Model partitions are read serially to bound API concurrency.
    await collectMatchingRecords(
      client,
      { ...state, model: modelId },
      selected,
      options,
      globalTotal,
    );
  }

  throwIfItemsRequestAborted(options.signal);
  if (selected.size !== globalTotal) throw new Error(CHANGED_SELECTION_MESSAGE);
  return selected;
}
