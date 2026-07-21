import type { Client, RawApiTypes } from '@datocms/cma-client-browser';
import type {
  ModelSummary,
  PublicationStatus,
  QueryState,
  RawItem,
} from '../types';
import type { ItemsPage } from './query';

const STATUS_ASC: readonly PublicationStatus[] = [
  'draft',
  'published',
  'updated',
];
const BUCKET_ORDER_BY = '_updated_at_DESC,id_ASC';

type PartitionOrder =
  | '_model_ASC'
  | '_model_DESC'
  | '_status_ASC'
  | '_status_DESC';

type Partition = {
  modelId?: string;
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
  if (args.partition?.modelId) {
    filter.type = args.partition.modelId;
  }

  return {
    nested: false,
    version: 'current',
    filter,
    order_by: BUCKET_ORDER_BY,
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
): Promise<number> {
  const response = await client.items.rawList(
    queryFor({ state, partition, offset: 0, limit: 0 }),
  );

  return typeof response.meta.total_count === 'number'
    ? response.meta.total_count
    : 0;
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
): Promise<RawItem[]> {
  const response = await client.items.rawList(
    queryFor({
      state,
      partition: plan.probe.partition,
      offset: plan.localOffset,
      limit: plan.limit,
    }),
  );

  return response.data;
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

  const totalCount = await probe(client, state, undefined);
  const pageStart = Math.max(0, state.page) * state.perPage;
  const pageEnd = Math.min(pageStart + state.perPage, totalCount);

  if (pageStart >= pageEnd) {
    return { items: [], totalCount };
  }

  const plans: SlicePlan[] = [];
  let globalStart = 0;

  for (const partition of partitionsFor(order, models)) {
    if (globalStart >= pageEnd) {
      break;
    }

    // biome-ignore lint/performance/noAwaitInLoops: Each count determines whether later buckets need probing.
    const count = await probe(client, state, partition);
    const partitionProbe: PartitionProbe = {
      partition,
      count,
      globalStart,
    };
    const plan = slicePlan(partitionProbe, pageStart, pageEnd);
    if (plan) {
      plans.push(plan);
    }
    globalStart += count;
  }

  const slices = await Promise.all(
    plans.map((plan) => fetchSlice(client, state, plan)),
  );

  return {
    items: slices.flat(),
    totalCount,
  };
}
