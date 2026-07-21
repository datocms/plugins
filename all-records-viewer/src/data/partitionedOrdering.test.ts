import type { Client, RawApiTypes } from '@datocms/cma-client-browser';
import { describe, expect, it, vi } from 'vitest';
import type {
  ModelSummary,
  PublicationStatus,
  QueryState,
  RawItem,
} from '../types';
import {
  fetchPartitionedItemsPage,
  shouldUsePartitionedOrdering,
} from './partitionedOrdering';

type TestRecord = RawItem & {
  __modelId: string;
  __status: PublicationStatus;
};

const MODELS: ModelSummary[] = [
  {
    id: 'model-b',
    name: 'Beta',
    apiKey: 'beta',
    draftModeActive: true,
    workflowId: null,
  },
  {
    id: 'model-a',
    name: 'alpha',
    apiKey: 'alpha',
    draftModeActive: true,
    workflowId: null,
  },
  {
    id: 'model-c',
    name: 'Gamma',
    apiKey: 'gamma',
    draftModeActive: true,
    workflowId: null,
  },
];

function record(
  id: string,
  modelId: string,
  status: PublicationStatus,
  updatedAt: string,
): TestRecord {
  return {
    id,
    type: 'item',
    attributes: {},
    relationships: {
      item_type: { data: { id: modelId, type: 'item_type' } },
    },
    meta: {
      created_at: updatedAt,
      updated_at: updatedAt,
      status,
    },
    __modelId: modelId,
    __status: status,
  } as unknown as TestRecord;
}

const RECORDS: TestRecord[] = [
  record('a-2', 'model-a', 'published', '2026-01-02T00:00:00Z'),
  record('a-1', 'model-a', 'draft', '2026-01-01T00:00:00Z'),
  record('b-2', 'model-b', 'updated', '2026-01-04T00:00:00Z'),
  record('b-1', 'model-b', 'published', '2026-01-03T00:00:00Z'),
  record('c-1', 'model-c', 'draft', '2026-01-05T00:00:00Z'),
];

const BASE_STATE: QueryState = {
  page: 0,
  perPage: 2,
  query: '',
  model: null,
  status: null,
  orderBy: null,
};

function testClient(records: readonly TestRecord[] = RECORDS) {
  const rawList = vi.fn(
    async (
      query: RawApiTypes.ItemInstancesHrefSchema,
    ): Promise<RawApiTypes.ItemInstancesTargetSchema> => {
      const filter = query.filter as
        | {
            type?: string;
            fields?: Record<string, { eq?: string; exists?: boolean }>;
          }
        | undefined;
      const status = filter?.fields?._status?.eq;
      const filtered = records
        .filter((item) => !filter?.type || item.__modelId === filter.type)
        .filter((item) => !status || item.__status === status)
        .sort(
          (left, right) =>
            right.meta.updated_at.localeCompare(left.meta.updated_at) ||
            left.id.localeCompare(right.id),
        );
      const offset = query.page?.offset ?? 0;
      const limit = query.page?.limit ?? 30;

      return {
        data: filtered.slice(offset, offset + limit),
        meta: { total_count: filtered.length },
      } as RawApiTypes.ItemInstancesTargetSchema;
    },
  );

  return {
    client: { items: { rawList } } as unknown as Pick<Client, 'items'>,
    rawList,
  };
}

function state(
  orderBy: '_model_ASC' | '_model_DESC' | '_status_ASC' | '_status_DESC',
  patch: Partial<QueryState> = {},
): QueryState {
  return {
    ...BASE_STATE,
    ...patch,
    orderBy: orderBy as QueryState['orderBy'],
  };
}

describe('fetchPartitionedItemsPage', () => {
  it('routes only meaningful global Model and Status orders', () => {
    expect(shouldUsePartitionedOrdering(state('_model_ASC'))).toBe(true);
    expect(shouldUsePartitionedOrdering(state('_status_DESC'))).toBe(true);
    expect(
      shouldUsePartitionedOrdering(
        state('_status_ASC', { status: 'published' }),
      ),
    ).toBe(false);
    expect(
      shouldUsePartitionedOrdering(state('_model_DESC', { model: 'model-a' })),
    ).toBe(false);
  });

  it('orders globally by model name and spans bucket boundaries', async () => {
    const { client, rawList } = testClient();
    const result = await fetchPartitionedItemsPage({
      client,
      models: MODELS,
      state: state('_model_ASC', { page: 1, perPage: 3 }),
    });

    expect(result.totalCount).toBe(5);
    expect(result.items.map((item) => item.id)).toEqual(['b-1', 'c-1']);
    expect(rawList).toHaveBeenCalledWith(
      expect.objectContaining({
        nested: false,
        version: 'current',
        order_by: '_updated_at_DESC,id_ASC',
      }),
    );
    for (const [query] of rawList.mock.calls) {
      expect(query.filter?.fields).toMatchObject({
        _created_at: { exists: true },
      });
    }
  });

  it('reverses model buckets for descending order', async () => {
    const { client } = testClient();
    const result = await fetchPartitionedItemsPage({
      client,
      models: MODELS,
      state: state('_model_DESC', { perPage: 3 }),
    });

    expect(result.items.map((item) => item.id)).toEqual(['c-1', 'b-2', 'b-1']);
  });

  it('orders status buckets using CMA status semantics', async () => {
    const { client } = testClient();
    const ascending = await fetchPartitionedItemsPage({
      client,
      models: MODELS,
      state: state('_status_ASC', { perPage: 4 }),
    });
    const descending = await fetchPartitionedItemsPage({
      client,
      models: MODELS,
      state: state('_status_DESC', { perPage: 3 }),
    });

    expect(ascending.items.map((item) => item.id)).toEqual([
      'c-1',
      'a-1',
      'b-1',
      'a-2',
    ]);
    expect(descending.items.map((item) => item.id)).toEqual([
      'b-2',
      'b-1',
      'a-2',
    ]);
  });

  it('applies an active status filter to every model bucket', async () => {
    const { client } = testClient();
    const result = await fetchPartitionedItemsPage({
      client,
      models: MODELS,
      state: state('_model_ASC', {
        status: 'published',
        perPage: 10,
      }),
    });

    expect(result.totalCount).toBe(2);
    expect(result.items.map((item) => item.id)).toEqual(['a-2', 'b-1']);
  });

  it('uses zero-record count probes and fetches only the requested page', async () => {
    const singletonRecords = Array.from({ length: 20 }, (_, index) =>
      record(
        `item-${index}`,
        `model-${index}`,
        'published',
        `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
      ),
    );
    const models = singletonRecords.map((item, index) => ({
      id: item.__modelId,
      name: String(index).padStart(2, '0'),
      apiKey: `model_${index}`,
      draftModeActive: true,
      workflowId: null,
    }));
    const { client, rawList } = testClient(singletonRecords);

    const result = await fetchPartitionedItemsPage({
      client,
      models,
      state: state('_model_ASC', { perPage: 5 }),
    });

    expect(result.items).toHaveLength(5);
    // One total probe, five lazy bucket probes, and five singleton slices.
    // Count probes return metadata only, so exactly one page of records is read.
    expect(rawList).toHaveBeenCalledTimes(11);
    expect(
      rawList.mock.calls.reduce(
        (total, [query]) => total + (query.page?.limit ?? 0),
        0,
      ),
    ).toBe(5);
  });

  it('returns exact totals without probing buckets for an out-of-range page', async () => {
    const { client, rawList } = testClient();
    const result = await fetchPartitionedItemsPage({
      client,
      models: MODELS,
      state: state('_model_ASC', { page: 20, perPage: 10 }),
    });

    expect(result).toEqual({ items: [], totalCount: 5 });
    expect(rawList).toHaveBeenCalledTimes(1);
    expect(rawList.mock.calls[0][0].page?.limit).toBe(0);
  });

  it('rejects cases owned by the ordinary CMA paginator', async () => {
    const { client } = testClient();

    await expect(
      fetchPartitionedItemsPage({
        client,
        models: MODELS,
        state: state('_model_ASC', { query: 'hello' }),
      }),
    ).rejects.toThrow(/during search/);
    await expect(
      fetchPartitionedItemsPage({
        client,
        models: MODELS,
        state: state('_status_ASC', { status: 'draft' }),
      }),
    ).rejects.toThrow(/status filter/);
    await expect(
      fetchPartitionedItemsPage({
        client,
        models: MODELS,
        state: state('_model_ASC', { model: 'model-a' }),
      }),
    ).rejects.toThrow(/selected model/);
  });
});
