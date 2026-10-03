import type { Client, RawApiTypes } from '@datocms/cma-client-browser';
import type {
  ModelSummary,
  PublicationStatus,
  QueryState,
  RawItem,
} from '../types';
import {
  type ItemsPage,
  itemsPageTotal,
  throwIfItemsRequestAborted,
  waitForItemsRequest,
} from './query';

const STATUS_ASC: readonly PublicationStatus[] = [
  'draft',
  'published',
  'updated',
];
const BUCKET_ORDER_BY = '_updated_at_DESC,id_ASC';
const READ_CONCURRENCY = 4;
// Keeps count-probe URLs bounded even when the schema has thousands of models.
const MODELS_PER_COUNT_GROUP = 50;

type PartitionOrder =
  | '_model_ASC'
  | '_model_DESC'
  | '_status_ASC'
  | '_status_DESC';

type Partition = {
  modelId?: string;
  modelIds?: readonly string[];
  status?: PublicationStatus;
};

type PartitionProbe = {
  partition: Partition;
  count: number;
  globalStart: number;
};

type SlicePlan = {
  probe: PartitionProbe;
  localOffset: number;
  limit: number;
};

type ItemsClient = Pick<Client, 'items'>;

export type FetchPartitionedItemsPageArgs = {
  client: ItemsClient;
  state: QueryState;
  models: readonly ModelSummary[];
  signal?: AbortSignal;
};

function partitionOrder(value: QueryState['orderBy']): PartitionOrder | null {
  const candidate = value as string | null;
  return candidate === '_model_ASC' ||
    candidate === '_model_DESC' ||
    candidate === '_status_ASC' ||
    candidate === '_status_DESC'
    ? candidate
    : null;
}

export function shouldUsePartitionedOrdering(state: QueryState): boolean {
  const order = partitionOrder(state.orderBy);
  if (!order || state.query.trim() || state.model) return false;
  return order.startsWith('_model_') || state.status === null;
}

function compareModels(left: ModelSummary, right: ModelSummary): number {
  return (
    left.name.localeCompare(right.name, undefined, {
      sensitivity: 'base',
    }) || left.id.localeCompare(right.id)
  );
}

function partitionsFor(
  order: PartitionOrder,
  models: readonly ModelSummary[],
): Partition[] {
  if (order.startsWith('_model_')) {
    const sorted = [...models].sort(compareModels);
    if (order.endsWith('_DESC')) {
      sorted.reverse();
    }
    return sorted.map((model) => ({ modelId: model.id }));
  }

  const statuses = [...STATUS_ASC];
  if (order.endsWith('_DESC')) {
    statuses.reverse();
  }
  return statuses.map((status) => ({ status }));
}

function queryFor(args: {
  state: QueryState;
  partition?: Partition;
  offset: number;
  limit: number;
}): RawApiTypes.ItemInstancesHrefSchema & { nested: false } {
  const partitionStatus = args.partition?.status;
  const status = partitionStatus ?? args.state.status;
  const fields: Record<string, Record<string, unknown>> = {
    _created_at: { exists: true },
  };

  if (status) {
    fields._status = { eq: status };
  }

  const filter: Record<string, unknown> = { fields };
  if (args.partition?.modelId || args.partition?.modelIds) {
    filter.type = args.partition.modelId ?? args.partition.modelIds?.join(',');
  }

  return {
    nested: false,
    version: 'current',
    filter,
    ...(args.limit > 0 ? { order_by: BUCKET_ORDER_BY } : {}),
    page: {
      offset: args.offset,
      limit: args.limit,
    },
  } as RawApiTypes.ItemInstancesHrefSchema & { nested: false };
}

async function probe(
  client: ItemsClient,
  state: QueryState,
  partition: Partition | undefined,
  signal?: AbortSignal,
): Promise<number> {
  throwIfItemsRequestAborted(signal);
  const response = await waitForItemsRequest(
    client.items.rawList(queryFor({ state, partition, offset: 0, limit: 0 })),
    signal,
  );
  throwIfItemsRequestAborted(signal);
  return itemsPageTotal(response, 0, 0);
}

function slicePlan(
  probeResult: PartitionProbe,
  pageStart: number,
  pageEnd: number,
): SlicePlan | null {
  const partitionEnd = probeResult.globalStart + probeResult.count;
  const overlapStart = Math.max(pageStart, probeResult.globalStart);
  const overlapEnd = Math.min(pageEnd, partitionEnd);

  if (overlapStart >= overlapEnd) {
    return null;
  }

  return {
    probe: probeResult,
    localOffset: overlapStart - probeResult.globalStart,
    limit: overlapEnd - overlapStart,
  };
}

async function fetchSlice(
  client: ItemsClient,
  state: QueryState,
  plan: SlicePlan,
  signal?: AbortSignal,
): Promise<RawItem[]> {
  const items: RawItem[] = [];
  do {
    throwIfItemsRequestAborted(signal);
    const offset = plan.localOffset + items.length;
    const limit = plan.limit - items.length;
    // biome-ignore lint/performance/noAwaitInLoops: A short slice is completed before the next offset is known.
    const response = await waitForItemsRequest(
      client.items.rawList(
        queryFor({ state, partition: plan.probe.partition, offset, limit }),
      ),
      signal,
    );
    throwIfItemsRequestAborted(signal);
    const total = itemsPageTotal(response, offset, limit);
    if (total !== plan.probe.count) {
      throw new Error(
        'Records changed while this page was loading. Refresh the view.',
      );
    }
    items.push(...response.data);
  } while (items.length < plan.limit);
  return items;
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  read: (value: T) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results: R[] = new Array(values.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < values.length) {
      throwIfItemsRequestAborted(signal);
      const index = next;
      next += 1;
      try {
        // biome-ignore lint/performance/noAwaitInLoops: Workers keep request concurrency bounded.
        results[index] = await read(values[index]);
      } catch (error: unknown) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(READ_CONCURRENCY, values.length) }, worker),
  );
  return results;
}

async function planPartitions(args: {
  client: ItemsClient;
  state: QueryState;
  partitions: readonly Partition[];
  globalStart: number;
  pageStart: number;
  pageEnd: number;
  signal?: AbortSignal;
}): Promise<SlicePlan[]> {
  const plans: SlicePlan[] = [];
  let globalStart = args.globalStart;
  for (
    let start = 0;
    start < args.partitions.length && globalStart < args.pageEnd;
    start += READ_CONCURRENCY
  ) {
    throwIfItemsRequestAborted(args.signal);
    const batch = args.partitions.slice(start, start + READ_CONCURRENCY);
    // biome-ignore lint/performance/noAwaitInLoops: Each window determines whether later partitions need probing.
    const counts = await mapWithConcurrency(
      batch,
      (partition) => probe(args.client, args.state, partition, args.signal),
      args.signal,
    );
    for (const [index, partition] of batch.entries()) {
      const count = counts[index];
      const partitionProbe = { partition, count, globalStart };
      const plan = slicePlan(partitionProbe, args.pageStart, args.pageEnd);
      if (plan && partition.modelIds) {
        // Only groups that overlap the page need per-model count probes.
        // biome-ignore lint/performance/noAwaitInLoops: Each group is detailed in model order.
        const groupPlans = await planPartitions({
          ...args,
          partitions: partition.modelIds.map((modelId) => ({ modelId })),
          globalStart,
        });
        plans.push(...groupPlans);
      } else if (plan) {
        plans.push(plan);
      }
      globalStart += count;
      if (globalStart >= args.pageEnd) break;
    }
  }
  return plans;
}

function countGroups(partitions: readonly Partition[]): Partition[] {
  if (partitions.length <= MODELS_PER_COUNT_GROUP || !partitions[0]?.modelId) {
    return [...partitions];
  }
  const groups: Partition[] = [];
  for (
    let start = 0;
    start < partitions.length;
    start += MODELS_PER_COUNT_GROUP
  ) {
    groups.push({
      modelIds: partitions
        .slice(start, start + MODELS_PER_COUNT_GROUP)
        .flatMap((partition) => (partition.modelId ? [partition.modelId] : [])),
    });
  }
  return groups;
}

/**
 * Builds an exact page for global Model or Status ordering without loading the
 * complete record collection. Search, an explicit model filter, and a constant
 * status sort are intentionally left to the ordinary CMA paginator.
 */
export async function fetchPartitionedItemsPage({
  client,
  state,
  models,
  signal,
}: FetchPartitionedItemsPageArgs): Promise<ItemsPage> {
  const order = partitionOrder(state.orderBy);
  if (!order) {
    throw new RangeError(
      'Partitioned ordering requires Model or Status order.',
    );
  }
  if (state.query.trim()) {
    throw new RangeError('Partitioned ordering is unavailable during search.');
  }
  if (state.model) {
    throw new RangeError(
      'Partitioned ordering is unnecessary with a selected model.',
    );
  }
  if (order.startsWith('_status_') && state.status) {
    throw new RangeError(
      'Partitioned status ordering is unnecessary with a status filter.',
    );
  }

  if (
    !Number.isSafeInteger(state.page) ||
    !Number.isSafeInteger(state.perPage) ||
    state.perPage < 1 ||
    state.perPage > 500 ||
    !Number.isSafeInteger(Math.max(0, state.page) * state.perPage)
  ) {
    throw new RangeError('Invalid record page.');
  }
  const totalCount = await probe(client, state, undefined, signal);
  const pageStart = Math.max(0, state.page) * state.perPage;
  const pageEnd = Math.min(pageStart + state.perPage, totalCount);

  if (pageStart >= pageEnd) {
    return { items: [], totalCount };
  }

  const plans = await planPartitions({
    client,
    state,
    partitions: countGroups(partitionsFor(order, models)),
    globalStart: 0,
    pageStart,
    pageEnd,
    signal,
  });
  if (
    plans.reduce((count, plan) => count + plan.limit, 0) !==
    pageEnd - pageStart
  ) {
    throw new Error(
      'Records changed while this page was loading. Refresh the view.',
    );
  }
  const slices = await mapWithConcurrency(
    plans,
    (plan) => fetchSlice(client, state, plan, signal),
    signal,
  );
  const items = slices.flat();
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new Error(
      'Records changed while this page was loading. Refresh the view.',
    );
  }

  return { items, totalCount };
}
