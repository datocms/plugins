import { makeClient } from '../services/cmaClient';
import {
  describeApiError,
  getApiErrorInfo,
  retryDelay,
} from '../services/requestErrors';

export type CreatorType = 'user' | 'sso_user' | 'account' | 'organization';
type Creator = { id: string; type: CreatorType };

export type BulkResult = {
  total: number;
  succeeded: number;
  failed: number;
  uncertain: number;
  unprocessed: number;
  failureSamples: Array<{ id: string; error: string }>;
  stopped: boolean;
  stopReason?: string;
};

export type BulkProgress = {
  total: number;
  succeeded: number;
  failed: number;
  uncertain: number;
  processed: number;
  active: number;
  retries: number;
  waitingUntil: number | null;
  stopping: boolean;
};

export type CreatorClient = {
  items: {
    update: (id: string, body: { creator: Creator }) => Promise<unknown>;
    find: (
      id: string,
    ) => Promise<{ creator?: { id: string; type: string } | null }>;
  };
};

export type Runtime = {
  now: () => number;
  sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  random: () => number;
};

type Options = {
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (progress: BulkProgress) => void;
  runtime?: Runtime;
};

type Params = Options & {
  apiToken: string;
  environment?: string;
  baseUrl?: string;
  itemIds: string[];
  userId: string;
  userType: CreatorType;
};

// Half the CMA's documented 60 requests/3 seconds, leaving room for other clients.
export const REQUEST_INTERVAL_MS = 100;
export const MAX_ATTEMPTS = 5;
export const FAILURE_SAMPLE_LIMIT = 5;

export function sleep(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal?.addEventListener('abort', finish, { once: true });
  });
}

const defaultRuntime: Runtime = {
  now: () => Date.now(),
  sleep,
  random: () => Math.random(),
};

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
    {
      items: {
        // The response is unused. Avoid the SDK's recursive record deserializer
        // traversing all localized fields, blocks and structured text on each PUT.
        update: (id, { creator }) =>
          client.request({
            method: 'PUT',
            url: `/items/${encodeURIComponent(id)}`,
            body: {
              data: {
                type: 'item',
                id,
                relationships: { creator: { data: creator } },
              },
            },
          }),
        find: async (id) => {
          const response = await client.request<{
            data: {
              relationships: {
                creator?: { data: { id: string; type: string } | null };
              };
            };
          }>({
            method: 'GET',
            url: `/items/${encodeURIComponent(id)}`,
            queryParams: { nested: false },
          });
          return { creator: response.data.relationships.creator?.data };
        },
      },
    },
    itemIds,
    { id: userId, type: userType },
    options,
  );
}

/** Only IDs are retained. The normal path never preloads records or their content. */
export async function changeCreators(
  client: CreatorClient,
  itemIds: readonly string[],
  creator: Creator,
  {
    concurrency = 6,
    signal,
    onProgress,
    runtime = defaultRuntime,
  }: Options = {},
): Promise<BulkResult> {
  if (
    !creator.id ||
    !['user', 'sso_user', 'account', 'organization'].includes(creator.type)
  ) {
    throw new Error('Invalid creator.');
  }
  const ids = new Set(itemIds);
  if (ids.has('')) throw new Error('Invalid record ID.');
  const iterator = ids.values();
  const result: BulkResult = {
    total: ids.size,
    succeeded: 0,
    failed: 0,
    uncertain: 0,
    unprocessed: 0,
    failureSamples: [],
    stopped: false,
  };
  let active = 0;
  let retries = 0;
  let stopped = false;
  let nextRequestAt = 0;
  let blockedUntil = 0;
  let lastProgressAt = -Infinity;
  const schedulingController = new AbortController();

  function progress(force = false) {
    const now = runtime.now();
    if (!force && now - lastProgressAt < 250) return;
    lastProgressAt = now;
    try {
      onProgress?.({
        total: result.total,
        succeeded: result.succeeded,
        failed: result.failed,
        uncertain: result.uncertain,
        processed: result.succeeded + result.failed + result.uncertain,
        active,
        retries,
        waitingUntil: blockedUntil > now ? blockedUntil : null,
        stopping: stopped || Boolean(signal?.aborted),
      });
    } catch {
      // A reporting failure must not interrupt or repeat an update.
    }
  }

  function stop(reason: string) {
    stopped = true;
    schedulingController.abort();
    result.stopReason ??= reason;
    progress(true);
  }

  function addFailure(id: string, error: string, uncertain = false) {
    if (uncertain) result.uncertain += 1;
    else result.failed += 1;
    if (result.failureSamples.length < FAILURE_SAMPLE_LIMIT) {
      result.failureSamples.push({ id, error });
    }
  }

  // Workers acquire a slot immediately before each request, including retries/GETs.
  // A shared cooldown prevents a 429 from triggering independent retry storms.
  async function takeSlot(): Promise<boolean> {
    while (true) {
      if (stopped || signal?.aborted) return false;
      const delay = Math.max(nextRequestAt, blockedUntil) - runtime.now();
      if (delay <= 0) {
        nextRequestAt = runtime.now() + REQUEST_INTERVAL_MS;
        return true;
      }
      // biome-ignore lint/performance/noAwaitInLoops: requests must acquire a paced slot sequentially.
      await runtime.sleep(
        Math.min(delay, 60_000),
        schedulingController.signal,
      );
    }
  }

  function backoff(error: unknown, attempt: number) {
    blockedUntil = Math.max(
      blockedUntil,
      runtime.now() +
        retryDelay(error, attempt, runtime.now(), runtime.random()),
    );
    retries += 1;
    progress(true);
  }

  // A lost PUT response is ambiguous. Never resend that PUT: even the same creator
  // can create another version/webhook. Confirm via bounded, read-only requests.
  async function confirmCreator(id: string): Promise<boolean> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: bounded retries must respect the shared rate limiter.
      if (!(await takeSlot())) return false;
      try {
        const record = await client.items.find(id);
        return (
          record.creator?.id === creator.id &&
          record.creator.type === creator.type
        );
      } catch (error) {
        const info = getApiErrorInfo(error);
        if (!info.retryable || attempt === MAX_ATTEMPTS - 1) return false;
        backoff(error, attempt);
      }
    }
    return false;
  }

  async function reconcile(id: string) {
    if (await confirmCreator(id)) {
      result.succeeded += 1;
      return;
    }
    addFailure(
      id,
      'Update outcome could not be confirmed. The request was not resent.',
      true,
    );
    stop(
      'An update outcome could not be confirmed. Remaining records were not started.',
    );
  }

  async function handleUpdateError(
    id: string,
    error: unknown,
    attempt: number,
  ) {
    const info = getApiErrorInfo(error);
    if (info.ambiguous) {
      await reconcile(id);
      return false;
    }
    if (info.retryable && attempt < MAX_ATTEMPTS - 1) {
      backoff(error, attempt);
      return true;
    }
    addFailure(id, describeApiError(error));
    if (info.status === 401)
      stop('Authentication failed. Remaining records were not started.');
    else if (info.retryable)
      stop(
        'The API remained unavailable after automatic retries. Remaining records were not started.',
      );
    return false;
  }

  async function update(id: string) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: retries of one record must run sequentially.
      if (attempt > 0 && !(await takeSlot())) {
        addFailure(
          id,
          'The update was rejected; its automatic retry was stopped.',
        );
        return;
      }
      try {
        await client.items.update(id, { creator });
        result.succeeded += 1;
        return;
      } catch (error) {
        if (!(await handleUpdateError(id, error, attempt))) return;
      }
    }
  }

  async function worker() {
    // biome-ignore lint/performance/noAwaitInLoops: each worker keeps only one update in flight.
    while (await takeSlot()) {
      if (stopped || signal?.aborted) return;
      const next = iterator.next();
      if (next.done) return;
      active += 1;
      progress();
      try {
        await update(next.value);
      } finally {
        active -= 1;
        progress();
      }
    }
  }

  const onAbort = () => {
    schedulingController.abort();
    progress(true);
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  progress(true);
  try {
    const limit = Number.isFinite(concurrency)
      ? Math.min(6, Math.max(1, Math.floor(concurrency)))
      : 6;
    await Promise.all(
      Array.from({ length: Math.min(limit, ids.size) }, worker),
    );
    result.unprocessed =
      result.total - result.succeeded - result.failed - result.uncertain;
    result.stopped =
      result.unprocessed > 0 || stopped || Boolean(signal?.aborted);
    return result;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    progress(true);
  }
}
