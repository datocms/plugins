import type { Client } from '@datocms/cma-client-browser';
import type { RawUpload } from '../presentation/previews';
import type { RawItem } from '../types';
import { itemsPageTotal } from './query';

/** Avoid starting a promise for every model or referenced entity at once. */
export async function mapBounded<T, R>(
  values: readonly T[],
  load: (value: T) => Promise<R>,
  concurrency = 2,
): Promise<R[]> {
  const result: R[] = new Array(values.length);
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new RangeError('Concurrency must be positive.');
  let next = 0;
  let failed = false;
  async function worker() {
    while (next < values.length && !failed) {
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
): Promise<T[]> {
  const unique = [...new Set(ids)].filter(Boolean);
  const batches: string[][] = [];
  for (let offset = 0; offset < unique.length; offset += 100) {
    batches.push(unique.slice(offset, offset + 100));
  }
  return (
    await mapBounded(batches, async (batch) => {
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
    })
  ).flat();
}

export function loadItemsById(
  client: Client,
  ids: readonly string[],
): Promise<RawItem[]> {
  return loadById(ids, async (batch, offset) => {
    const response = await client.items.rawList({
      nested: false,
      version: 'current',
      filter: { ids: batch.join(',') },
      page: { limit: batch.length, offset },
    });
    return response;
  });
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
