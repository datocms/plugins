import { ApiError, TimeoutError } from '@datocms/cma-client-browser';
import { cancellable, throwIfAborted } from '../data/cancellation';
import {
  buildCmaClient,
  type CmaClientContext,
  readRecords,
  toRecordInput,
} from '../data/records';
import type { createSchemaLoader } from '../data/schema';
import { extractLinks } from '../extraction/extract';
import { errorMessage, type ScanSession } from '../state/session';
import type { ScanProducer } from '../state/useScan';
import type { ContentModel } from '../types';

type SchemaLoader = ReturnType<typeof createSchemaLoader>;

const LOAD_FAILED = "The records couldn't be loaded. Scan again to retry.";

/** The API client's own messages ("API Error!", "Failed to fetch") say nothing useful. */
function readFailure(error: unknown): string {
  if (error instanceof ApiError) {
    const { status } = error.response;
    if (status === 403 || error.findError('INSUFFICIENT_PERMISSIONS'))
      return 'Your role cannot read its records.';
    if (status === 401)
      return 'The API token was rejected. Reload the page and scan again.';
    return LOAD_FAILED;
  }
  if (error instanceof TimeoutError)
    return 'The request timed out. Scan again to retry.';
  // A network failure
  if (error instanceof TypeError) return LOAD_FAILED;
  return errorMessage(error);
}

async function scanModel(
  client: ReturnType<typeof buildCmaClient>,
  loader: SchemaLoader,
  summary: ContentModel,
  locales: string[],
  session: ScanSession,
  signal: AbortSignal,
) {
  try {
    const schema = await loader.load(summary.id, signal, (warning) =>
      session.warn(`${summary.name}: ${warning}`),
    );
    if (signal.aborted) return;
    const model = schema.get(summary.id);
    if (!model) throw new Error("The model's fields couldn't be loaded.");
    let yieldedAt = performance.now();
    for await (const raw of readRecords(client, summary.id, signal)) {
      try {
        session.addRecord(
          extractLinks(toRecordInput(raw, model, locales[0]), schema, locales),
        );
      } catch (error) {
        throwIfAborted(signal);
        session.addRecord({
          occurrences: [],
          warnings: [`${summary.name} ${raw.id}: ${readFailure(error)}`],
        });
      }
      // Automatically let network checks catch up without retaining whole record pages.
      await session.waitForCapacity();
      if (performance.now() - yieldedAt >= 12) {
        // Async iteration only yields microtasks; let the browser paint and process cancellation.
        await new Promise((resolve) => setTimeout(resolve, 0));
        throwIfAborted(signal);
        yieldedAt = performance.now();
      }
    }
  } catch (error) {
    if (signal.aborted) return;
    console.error(error);
    session.warn(`${summary.name}: ${readFailure(error)}`);
  }
}

/** Bounded ID batches keep count URLs small, even with thousands of models. */
export async function countRecords(
  client: ReturnType<typeof buildCmaClient>,
  models: ContentModel[],
  signal?: AbortSignal,
): Promise<number> {
  let total = 0;
  let batch: string[] = [];
  const addBatch = async () => {
    if (!batch.length) return;
    const type = batch.join(',');
    batch = [];
    const response = await cancellable(
      client.items.rawList({
        filter: { type },
        page: { limit: 0 },
        version: 'current',
      }),
      signal,
    );
    const count = response.meta?.total_count;
    if (
      !Number.isSafeInteger(count) ||
      count < 0 ||
      !Number.isSafeInteger(total + count)
    )
      throw new Error('The API returned no record count.');
    total += count;
  };
  for (const id of new Set(models.map((model) => model.id))) {
    throwIfAborted(signal);
    if (
      batch.length >= 50 ||
      encodeURIComponent([...batch, id].join(',')).length > 1_500
    ) {
      // biome-ignore lint/performance/noAwaitInLoops: Keep both ID count and encoded query size bounded, and stop counts on cancellation.
      await addBatch();
    }
    batch.push(id);
  }
  await addBatch();
  return total;
}

/**
 * Reads the latest saved records of each model in turn and feeds their links
 * to the session. The record count, for the progress bar, is fetched alongside
 * and reported through `onRecordTotal`; without it the bar can't show a
 * percentage while records are read.
 */
export function createProjectProducer(
  ctx: CmaClientContext,
  loader: SchemaLoader,
  models: ContentModel[],
  locales: string[],
  onRecordTotal?: (total: number) => void,
): ScanProducer {
  return async (session, signal) => {
    const client = buildCmaClient(ctx);
    if (onRecordTotal && models.length > 0)
      void countRecords(client, models, signal).then(
        (total) => {
          if (!signal.aborted) onRecordTotal(total);
        },
        (error: unknown) => console.warn(error),
      );
    for (const summary of models) {
      if (signal.aborted) break;
      // biome-ignore lint/performance/noAwaitInLoops: Stream one model at a time without retaining record payloads.
      await scanModel(client, loader, summary, locales, session, signal);
    }
  };
}
