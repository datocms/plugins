import { makeClient } from "../services/cmaClient";

export type BulkResult = {
	ok: string[];
	fail: Array<{ id: string; error: unknown }>;
};

type Params = {
	apiToken: string;
	environment?: string;
	itemIds: string[];
	userId: string;
	concurrency?: number;
};

export async function bulkChangeCreator({
	apiToken,
	environment,
	itemIds,
	userId,
	concurrency = 6,
}: Params): Promise<BulkResult> {
	const client = makeClient(apiToken, environment);
	const successes: string[] = [];
	const failures: Array<{ id: string; error: unknown }> = [];

	await runWithConcurrency(itemIds, concurrency, async (itemId) => {
		try {
			await client.items.update(itemId, {
				creator: { id: userId, type: "user" },
			});
			successes.push(itemId);
		} catch (error) {
			failures.push({ id: itemId, error });
		}
	});

	return { ok: successes, fail: failures };
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
	const runners = Array.from({ length: Math.min(safeLimit, queue.length) }, async () => {
		while (queue.length > 0) {
			const next = queue.shift();
			if (next === undefined) {
				return;
			}

			await worker(next);
		}
	});

	await Promise.all(runners);
}
