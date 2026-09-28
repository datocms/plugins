import { ApiError, TimeoutError } from '@datocms/cma-client-browser';
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
    const schema = await loader.load(summary.id);
    if (signal.aborted) return;
    const model = schema.get(summary.id);
    if (!model) throw new Error("The model's fields couldn't be loaded.");
    for await (const raw of readRecords(client, summary.id, signal)) {
      session.addRecord(
        extractLinks(toRecordInput(raw, model, locales[0]), schema, locales),
      );
    }
  } catch (error) {
    if (signal.aborted) return;
    console.error(error);
    session.warn(`${summary.name}: ${readFailure(error)}`);
  }
}

/** How many records the scan will read: one request for every model, asking for a single record. */
async function countRecords(
  client: ReturnType<typeof buildCmaClient>,
  models: ContentModel[],
): Promise<number> {
  const response = await client.items.rawList({
    filter: { type: models.map((model) => model.id).join(',') },
    page: { limit: 1 },
    version: 'current',
  });
  const total = response.meta?.total_count;
  if (!Number.isSafeInteger(total) || total < 0)
    throw new Error('The API returned no record count.');
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
      void countRecords(client, models).then(
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
