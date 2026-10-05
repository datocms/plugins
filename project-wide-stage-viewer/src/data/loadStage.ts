import {
  ApiError,
  type Client,
  type RawApiTypes,
} from '@datocms/cma-client-browser';
import {
  buildModelPresentation,
  buildRow,
  type RecordRow,
} from '../lib/records';
import type { RawItem, Workflow } from '../types';
import {
  formatTitle,
  getTitleField,
  isLinkField,
  linkedItemIdFromValue,
  readFieldValue,
} from '../lib/presentation';
import { itemsPageTotal, loadItemsById } from './loadById';

type ItemType = RawApiTypes.ItemType;
type Field = RawApiTypes.Field;

export type StageSource = {
  client: Client;
  itemTypes: Partial<Record<string, ItemType>>;
  locales: readonly string[];
  /** The project's timezone, for date and date-time titles. */
  timeZone?: string;
  loadItemTypeFields: (itemTypeId: string) => Promise<Field[]>;
};

export type StageData = {
  /** The live workflow. Null when it couldn't be read (the saved names apply). */
  workflow: Workflow | null;
  /** True when the workflow or the stage was deleted after the page was set up. */
  stageMissing: boolean;
  /** Models that use the workflow, by name. */
  models: ItemType[];
  rows: RecordRow[];
};

/** Models (not block models) that use the workflow, sorted by name. */
export function workflowModels(
  itemTypes: Partial<Record<string, ItemType>>,
  workflowId: string,
): ItemType[] {
  return Object.values(itemTypes)
    .filter(
      (itemType): itemType is ItemType =>
        Boolean(itemType) &&
        !itemType?.attributes.modular_block &&
        itemType?.relationships.workflow.data?.id === workflowId,
    )
    .sort((a, b) => a.attributes.name.localeCompare(b.attributes.name));
}

async function fetchWorkflow(
  client: Client,
  workflowId: string,
): Promise<Workflow | 'missing' | null> {
  try {
    const workflow = await client.workflows.find(workflowId);
    return {
      id: workflow.id,
      name: workflow.name,
      stages: workflow.stages.map(({ id, name }) => ({ id, name })),
    };
  } catch (error) {
    if (error instanceof ApiError && error.response.status === 404) {
      return 'missing';
    }
    // Reading the workflow only refreshes names; the records can still load.
    return null;
  }
}

/**
 * Runs `task` over `values`, at most `limit` at a time, keeping the order.
 * After a failure or an abort, no further task starts.
 */
export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  limit: number,
  task: (value: T) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  let failed = false;
  async function worker() {
    while (next < values.length && !failed && !signal?.aborted) {
      const index = next;
      next += 1;
      try {
        // biome-ignore lint/performance/noAwaitInLoops: each worker runs its share of tasks one after another, by design
        results[index] = await task(values[index]);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, worker),
  );
  return results;
}

/** Records per request: small enough to download well within the timeout. */
export const STAGE_PAGE_SIZE = 200;

function fetchStagePage(
  source: StageSource,
  itemTypeId: string,
  stageId: string,
  page: { offset: number; limit: number },
) {
  return source.client.items.rawList({
    filter: { type: itemTypeId, fields: { _stage: { eq: stageId } } },
    version: 'current',
    // A stable order keeps the pages consistent with each other.
    order_by: 'id_ASC',
    page,
  });
}

async function loadModelRows(
  source: StageSource,
  itemType: ItemType,
  stageId: string,
  signal: AbortSignal,
): Promise<RecordRow[]> {
  const fields = await source.loadItemTypeFields(itemType.id);
  const presentation = buildModelPresentation(itemType, fields);
  // Keyed by ID: a record that moves into the stage mid-load can shift into
  // the next page and come back twice.
  const rows = new Map<string, RecordRow>();
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  // One page at a time, so an abort stops the download between pages.
  while (offset < total && !signal.aborted) {
    // biome-ignore lint/performance/noAwaitInLoops: pages load in order so an abort stops the rest
    const page = await fetchStagePage(source, itemType.id, stageId, {
      offset,
      limit: STAGE_PAGE_SIZE,
    });
    total = itemsPageTotal(page, offset, STAGE_PAGE_SIZE);
    if (page.data.length === 0) break;
    offset += page.data.length;
    for (const item of page.data) {
      if (rows.has(item.id)) continue;
      rows.set(
        item.id,
        buildRow(item, presentation, {
          locales: source.locales,
          timeZone: source.timeZone,
        }),
      );
    }
  }
  return [...rows.values()];
}

/** Linked titles are followed at most this many records deep, as in the dashboard. */
const MAX_TITLE_DEPTH = 3;

type PendingTitle = { row: RecordRow; linkId: string; seen: Set<string> };

/** Applies a linked record's title, or returns the next link to follow. */
function applyLinkedTitle(
  entry: PendingTitle,
  item: RawItem | undefined,
  source: StageSource,
  fieldsByModel: ReadonlyMap<string, Field[]>,
): PendingTitle[] {
  const modelId = item?.relationships.item_type.data.id;
  const itemType = modelId ? source.itemTypes[modelId] : undefined;
  const fields = modelId ? fieldsByModel.get(modelId) : undefined;
  const titleField =
    itemType && fields ? getTitleField(itemType, fields) : undefined;
  if (!item || !titleField) return [];

  const value = readFieldValue(
    item.attributes as Record<string, unknown>,
    titleField,
    source.locales,
  );
  if (isLinkField(titleField)) {
    const linkId = linkedItemIdFromValue(value);
    return linkId && !entry.seen.has(linkId)
      ? [{ ...entry, linkId, seen: new Set([...entry.seen, linkId]) }]
      : [];
  }
  const title = formatTitle(value, titleField, source);
  if (title) entry.row.title = title;
  return [];
}

/** Reads one level of linked records and applies their titles. */
async function resolveTitleLevel(
  source: StageSource,
  pending: readonly PendingTitle[],
  signal: AbortSignal,
): Promise<PendingTitle[]> {
  const linked = await loadItemsById(
    source.client,
    [...new Set(pending.map(({ linkId }) => linkId))],
    signal,
  );
  const byId = new Map(linked.map((item) => [item.id, item]));
  const modelIds = [
    ...new Set(linked.map((item) => item.relationships.item_type.data.id)),
  ];
  const fieldsByModel = new Map(
    await Promise.all(
      modelIds.map(
        async (modelId) =>
          [modelId, await source.loadItemTypeFields(modelId)] as const,
      ),
    ),
  );
  return pending.flatMap((entry) =>
    applyLinkedTitle(entry, byId.get(entry.linkId), source, fieldsByModel),
  );
}

/**
 * Gives rows whose title field links to another record (or a single block)
 * that record's title, reading the linked records in batches, up to three
 * links deep. A title that can't be resolved keeps its "Record #id".
 */
export async function resolveLinkedTitles(
  source: StageSource,
  rows: readonly RecordRow[],
  signal: AbortSignal,
): Promise<void> {
  let pending: PendingTitle[] = rows.flatMap((row) =>
    row.titleLinkId
      ? [{ row, linkId: row.titleLinkId, seen: new Set([row.id]) }]
      : [],
  );
  for (let depth = 0; depth < MAX_TITLE_DEPTH && pending.length > 0; depth++) {
    if (signal.aborted) return;
    // biome-ignore lint/performance/noAwaitInLoops: each level needs the previous one's records
    pending = await resolveTitleLevel(source, pending, signal);
  }
}

/**
 * Every record in the stage, across the models that use its workflow. The API
 * filters by stage, so only the stage's records are downloaded.
 */
export async function loadStage(
  source: StageSource,
  { workflowId, stageId }: { workflowId: string; stageId: string },
  signal: AbortSignal,
): Promise<StageData> {
  const workflow = await fetchWorkflow(source.client, workflowId);
  const models = workflowModels(source.itemTypes, workflowId);
  const stageMissing =
    workflow === 'missing' ||
    (workflow !== null && !workflow.stages.some(({ id }) => id === stageId));

  if (stageMissing || signal.aborted) {
    return {
      workflow: workflow === 'missing' ? null : workflow,
      stageMissing,
      models,
      rows: [],
    };
  }

  // One model failing stops the others too, instead of letting them page on.
  const loading = new AbortController();
  const stop = () => loading.abort();
  signal.addEventListener('abort', stop, { once: true });
  try {
    const groups = await mapWithConcurrency(
      models,
      4,
      async (itemType) => {
        try {
          return await loadModelRows(source, itemType, stageId, loading.signal);
        } catch (error) {
          stop();
          throw error;
        }
      },
      loading.signal,
    );
    const rows = groups.flat();
    try {
      await resolveLinkedTitles(source, rows, loading.signal);
    } catch {
      // Linked titles are a nicety: keep the placeholders if they can't be read.
    }
    return { workflow, stageMissing, models, rows };
  } finally {
    signal.removeEventListener('abort', stop);
  }
}
