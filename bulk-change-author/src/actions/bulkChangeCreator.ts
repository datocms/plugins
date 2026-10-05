import { makeClient } from '../services/cmaClient';
import {
  describeApiError,
  isAuthenticationError,
} from '../services/requestErrors';

export type CreatorType = 'user' | 'sso_user' | 'account' | 'organization';
type Creator = { id: string; type: CreatorType };

export type BulkResult = {
  total: number;
  succeeded: number;
  failed: number;
  unprocessed: number;
  failureSamples: Array<{ id: string; error: string }>;
  stopped: boolean;
  stopReason?: string;
};

export type BulkProgress = {
  total: number;
  succeeded: number;
  failed: number;
  processed: number;
  active: number;
  stopping: boolean;
};

export type CreatorClient = {
  items: {
    update: (id: string, body: { creator: Creator }) => Promise<unknown>;
  };
};

type Options = {
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (progress: BulkProgress) => void;
};

type Params = Options & {
  apiToken: string;
  environment?: string;
  baseUrl?: string;
  itemIds: string[];
  userId: string;
  userType: CreatorType;
};

export const FAILURE_SAMPLE_LIMIT = 5;
const PROGRESS_INTERVAL_MS = 250;

export function bulkChangeCreator({
  apiToken,
  environment,
  baseUrl,
  itemIds,
  userId,
  userType,
  ...options
}: Params): Promise<BulkResult> {
  const client = makeClient(apiToken, environment, baseUrl);
  return changeCreators(
    client,
    itemIds,
    { id: userId, type: userType },
    options,
  );
}

/** Updates the creator of each record, a few at a time. */
export async function changeCreators(
  client: CreatorClient,
  itemIds: readonly string[],
  creator: Creator,
  { concurrency = 6, signal, onProgress }: Options = {},
): Promise<BulkResult> {
  if (
    !creator.id ||
    !['user', 'sso_user', 'account', 'organization'].includes(creator.type)
  ) {
    throw new Error('Invalid creator.');
  }
  const ids = new Set(itemIds);
  if (ids.has('')) throw new Error('Invalid record ID.');
  const queue = ids.values();
  const result: BulkResult = {
    total: ids.size,
    succeeded: 0,
    failed: 0,
    unprocessed: 0,
    failureSamples: [],
    stopped: false,
  };
  let active = 0;
  let lastProgressAt = Number.NEGATIVE_INFINITY;

  const isStopping = () => Boolean(signal?.aborted) || result.stopped;

  function progress(force = false) {
    const now = Date.now();
    if (!force && now - lastProgressAt < PROGRESS_INTERVAL_MS) return;
    lastProgressAt = now;
    try {
      onProgress?.({
        total: result.total,
        succeeded: result.succeeded,
        failed: result.failed,
        processed: result.succeeded + result.failed,
        active,
        stopping: isStopping(),
      });
    } catch {
      // A reporting failure must not interrupt the updates.
    }
  }

  async function update(id: string) {
    try {
      await client.items.update(id, { creator });
      result.succeeded += 1;
    } catch (error) {
      result.failed += 1;
      if (result.failureSamples.length < FAILURE_SAMPLE_LIMIT) {
        result.failureSamples.push({ id, error: describeApiError(error) });
      }
      // Every remaining request would fail the same way.
      if (isAuthenticationError(error)) {
        result.stopped = true;
        result.stopReason ??=
          'Authentication failed. Remaining records were not started.';
      }
    }
  }

  async function worker() {
    for (const id of queue) {
      if (isStopping()) return;
      active += 1;
      progress();
      // biome-ignore lint/performance/noAwaitInLoops: each worker keeps one update in flight.
      await update(id);
      active -= 1;
      progress();
    }
  }

  const onAbort = () => progress(true);
  signal?.addEventListener('abort', onAbort, { once: true });
  progress(true);
  try {
    const limit = Math.max(1, Math.floor(concurrency) || 1);
    await Promise.all(
      Array.from({ length: Math.min(limit, ids.size) }, worker),
    );
    result.unprocessed = result.total - result.succeeded - result.failed;
    result.stopped ||= result.unprocessed > 0;
    return result;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    progress(true);
  }
}
