import type { Client, RawApiTypes } from '@datocms/cma-client-browser';
import type { RawItem } from '../types';

type RawUpload = RawApiTypes.Upload;

/** Validates one page of an ID-filtered list and returns its total count. */
export function itemsPageTotal(
  response: { data: readonly { id: string }[]; meta: { total_count: number } },
  offset: number,
  limit: number,
): number {
  const total = response.meta?.total_count;
  if (
    !Array.isArray(response.data) ||
    !Number.isSafeInteger(total) ||
    total < 0 ||
    response.data.length > limit ||
    response.data.some((item) => !item?.id)
  ) {
    throw new Error(
      'The API returned an incomplete record page. Refresh the view.',
    );
  }
  if (limit > 0 && response.data.length === 0 && offset < total) {
    throw new Error(
      'The API returned an empty page before its record total. Refresh the view.',
    );
  }
  if (response.data.length > 0 && offset + response.data.length > total) {
    throw new Error(
      'The API returned a page beyond its record total. Refresh the view.',
    );
  }
  return total;
}

/** Avoid starting a promise for every model or referenced entity at once. */
export async function mapBounded<T, R>(
  values: readonly T[],
  load: (value: T) => Promise<R>,
  concurrency = 2,
  signal?: AbortSignal,
): Promise<R[]> {
  const result: R[] = new Array(values.length);
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new RangeError('Concurrency must be positive.');
  let next = 0;
  let failed = false;
  async function worker() {
    while (next < values.length && !failed && !signal?.aborted) {
      const index = next++;
      try {
        // biome-ignore lint/performance/noAwaitInLoops: Limit concurrent loaders.
        result[index] = await load(values[index]);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, worker),
  );
  return result;
}

async function loadById<T extends { id: string }>(
  ids: readonly string[],
  load: (
    batch: string[],
    offset: number,
  ) => Promise<{ data: T[]; meta: { total_count: number } }>,
  signal?: AbortSignal,
): Promise<T[]> {
  const unique = [...new Set(ids)].filter(Boolean);
  const batches: string[][] = [];
  for (let offset = 0; offset < unique.length; offset += 100) {
    batches.push(unique.slice(offset, offset + 100));
  }
  return (
    await mapBounded(
      batches,
      async (batch) => {
        const result: T[] = [];
        const seen = new Set<string>();
        let total: number | undefined;
        do {
          // biome-ignore lint/performance/noAwaitInLoops: Complete short ID-filter pages without concurrent offsets.
          const response = await load(batch, result.length);
          const count = itemsPageTotal(response, result.length, batch.length);
          if (total !== undefined && count !== total)
            throw new Error('Referenced records changed while loading.');
          total = count;
          for (const entity of response.data) {
            if (seen.has(entity.id))
              throw new Error('The API returned duplicate identities.');
            seen.add(entity.id);
            result.push(entity);
          }
        } while (result.length < total);
        return result;
      },
      2,
      signal,
    )
  ).flat();
}

export function loadItemsById(
  client: Client,
  ids: readonly string[],
  signal?: AbortSignal,
): Promise<RawItem[]> {
  return loadById(
    ids,
    async (batch, offset) => {
      const response = await client.items.rawList({
        nested: false,
        version: 'current',
        filter: { ids: batch.join(',') },
        page: { limit: batch.length, offset },
      });
      return response;
    },
    signal,
  );
}

export function loadUploadsById(
  client: Client,
  ids: readonly string[],
): Promise<RawUpload[]> {
  return loadById(ids, async (batch, offset) => {
    const response = await client.uploads.rawList({
      filter: { ids: batch.join(',') },
      page: { limit: batch.length, offset },
    });
    return response;
  });
}
