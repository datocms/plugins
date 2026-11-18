import {
  ApiError,
  type Client,
  type RawApiTypes,
} from '@datocms/cma-client-browser';
import type { ResolvedItemPresentationInfo } from 'datocms-plugin-sdk';
import { buildRow, type RecordRow, withPresentation } from '../lib/records';
import type { Workflow } from '../types';
import { itemsPageTotal } from './loadById';

type ItemType = RawApiTypes.ItemType;

export type StageSource = {
  client: Client;
  itemTypes: Partial<Record<string, ItemType>>;
  /**
   * How DatoCMS presents the records (`ctx.loadItemPresentationInfo`): their
   * title, image and status, as its own lists show them.
   */
  loadItemPresentationInfo: (
    ids: string[],
  ) => Promise<Array<ResolvedItemPresentationInfo | null>>;
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
      rows.set(item.id, buildRow(item, itemType));
    }
  }
  return [...rows.values()];
}

/** Records whose presentation one call to the host asks for. */
export const PRESENTATIONS_PER_CALL = 200;

/**
 * The rows with the title, the image and the status that DatoCMS shows for
 * each record, asked of the host in batches. A record the host doesn't
 * present keeps its "Record #ID".
 */
export async function loadPresentations(
  source: StageSource,
  rows: readonly RecordRow[],
  signal: AbortSignal,
): Promise<RecordRow[]> {
  const byId = new Map<string, ResolvedItemPresentationInfo>();
  for (
    let start = 0;
    start < rows.length && !signal.aborted;
    start += PRESENTATIONS_PER_CALL
  ) {
    const ids = rows
      .slice(start, start + PRESENTATIONS_PER_CALL)
      .map(({ id }) => id);
    // biome-ignore lint/performance/noAwaitInLoops: one batch at a time, so an abort stops the rest
    const infos = await source.loadItemPresentationInfo(ids);
    for (const info of infos) if (info) byId.set(info.id, info);
  }
  return rows.map((row) => {
    const info = byId.get(row.id);
    return info ? withPresentation(row, info) : row;
  });
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
    let rows = groups.flat();
    try {
      rows = await loadPresentations(source, rows, loading.signal);
    } catch {
      // The titles are a nicety: keep "Record #ID" if the host can't give them.
    }
    return { workflow, stageMissing, models, rows };
  } finally {
    signal.removeEventListener('abort', stop);
  }
}
