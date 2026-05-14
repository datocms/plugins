import { makeClient } from '../services/cmaClient';

export type BulkResult = {
  ok: string[];
  fail: Array<{ id: string; error: unknown }>;
};

type Params = {
  apiToken: string;
  environment?: string;
  baseUrl?: string;
  itemIds: string[];
  userId: string;
  userType: 'user' | 'sso_user' | 'account' | 'organization';
  concurrency?: number;
};

export async function bulkChangeCreator({
  apiToken,
  environment,
  baseUrl,
  itemIds,
  userId,
  userType,
  concurrency = 6,
}: Params): Promise<BulkResult> {
  const client = makeClient(apiToken, environment, baseUrl);
  const successes: string[] = [];
  const failures: Array<{ id: string; error: unknown }> = [];

  await runWithConcurrency(itemIds, concurrency, async (itemId) => {
    try {
      await client.items.update(itemId, {
        creator: { id: userId, type: userType },
      });
      successes.push(itemId);
    } catch (error) {
      failures.push({ id: itemId, error });
    }
  });

  return { ok: successes, fail: failures };
}

async function drainQueue<T>(
  queue: T[],
  worker: (input: T) => Promise<void>,
): Promise<void> {
  const next = queue.shift();
  if (next === undefined) {
    return;
  }
  await worker(next);
  return drainQueue(queue, worker);
}

async function runWithConcurrency<T>(
  inputs: T[],
  limit: number,
  worker: (input: T) => Promise<void>,
) {
  if (inputs.length === 0) {
    return;
  }

  const queue = [...inputs];
  const safeLimit = Math.max(1, limit);
  const runnerCount = Math.min(safeLimit, queue.length);
  const runners = Array.from({ length: runnerCount }, () =>
    drainQueue(queue, worker),
  );

  await Promise.all(runners);
}
