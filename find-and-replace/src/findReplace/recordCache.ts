/**
 * The read-once record cache (SPEC-ADDENDUM A1, G12). After a model was
 * scanned completely, its raw nested records stay in memory so the next
 * search (new pattern, toggles, "Search again") re-matches them locally
 * instead of downloading them again.
 *
 * - Keyed by model. An entry is written only when that model's scan read it
 *   from its first record to its last (not cancelled, stopped, capped,
 *   failed or resumed), with the records exactly as fetched (current
 *   version; `nested` when the model can hold blocks).
 * - At most `maxRecords` records, and about `maxBytes` of them (measured as
 *   JSON), across models; a model that doesn't fit is not cached (it is
 *   downloaded on every search). Records can be large (Structured Text,
 *   blocks), so the count alone could let the page grow to hundreds of MB.
 * - An entry older than `ttlMs` is ignored; the next search downloads it
 *   again. Expired entries are released when a search starts.
 * - After a run pass, the records it attempted are re-read by id and replaced
 *   in their entries (deleted ones removed). Searches wait for that first.
 *
 * It lives on the main thread, so a matcher worker timeout never loses it.
 */

import type { Client } from '@datocms/cma-client-browser';
import {
  type DiscoveryRecordSource,
  type ModelRecordSource,
  networkRecordSource,
  replayRecordSource,
} from '../selection/discovery';
import {
  type DiscoveryModel,
  fetchRecordsByIds,
  type RawNestedItem,
} from '../selection/query';
import type { RequestPool } from '../selection/requestPool';

export type RecordCacheOptions = {
  maxRecords: number;
  /** Size budget across models, in JSON characters. No size limit when omitted. */
  maxBytes?: number;
  ttlMs: number;
  /** Defaults to `Date.now`. */
  now?: () => number;
  /** The post-run refresh shares the searches' request slots and pace. */
  pool?: RequestPool;
};

type CacheEntry = {
  records: ReadonlyArray<RawNestedItem>;
  /** When the scan that filled it started. */
  fetchedAt: number;
  /** `recordsSize(records)`. */
  bytes: number;
};

/**
 * Roughly what a record weighs, in JSON characters (its parsed form takes a
 * bit more memory). Nested records are plain API JSON, so this never throws.
 */
export function recordSize(record: RawNestedItem): number {
  return JSON.stringify(record).length;
}

function recordsSize(records: ReadonlyArray<RawNestedItem>): number {
  let total = 0;
  for (const record of records) total += recordSize(record);
  return total;
}

export type CacheRecordSourceOptions = {
  /** Models that must come from the network even when cached ('all' for every model). */
  network?: 'all' | ReadonlySet<string>;
  /** Awaited between replayed batches (the controller's timers). */
  yieldToEventLoop?: () => Promise<void>;
};

export class RecordCache {
  private readonly entries = new Map<string, CacheEntry>();
  private refreshing: Promise<void> | null = null;
  /** Bumped by `clear()`: scans and refreshes that started earlier write nothing. */
  private generation = 0;

  constructor(private readonly options: RecordCacheOptions) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private isExpired(entry: CacheEntry): boolean {
    return this.now() - entry.fetchedAt >= this.options.ttlMs;
  }

  private get maxBytes(): number {
    return this.options.maxBytes ?? Number.POSITIVE_INFINITY;
  }

  /** The cached records of a model: complete and younger than the TTL, else null. */
  fresh(modelId: string): ReadonlyArray<RawNestedItem> | null {
    const entry = this.entries.get(modelId);
    return entry && !this.isExpired(entry) ? entry.records : null;
  }

  /** Every one of these models has a fresh entry (a search would not download anything). */
  covers(modelIds: Iterable<string>): boolean {
    for (const modelId of modelIds) {
      if (!this.fresh(modelId)) return false;
    }
    return true;
  }

  /** Records held, across models (expired entries included until released). */
  get size(): number {
    let total = 0;
    for (const entry of this.entries.values()) total += entry.records.length;
    return total;
  }

  /** JSON characters held, across models (see `recordSize`). */
  get bytes(): number {
    let total = 0;
    for (const entry of this.entries.values()) total += entry.bytes;
    return total;
  }

  has(modelId: string): boolean {
    return this.entries.has(modelId);
  }

  /**
   * Keeps a model's complete scan, unless it would take the cache over
   * `maxRecords` or `maxBytes` (then any older entry of the model is dropped
   * too). `bytes`: `recordsSize(records)` when the caller measured it.
   */
  store(
    modelId: string,
    records: ReadonlyArray<RawNestedItem>,
    fetchedAt: number = this.now(),
    bytes: number = recordsSize(records),
  ): boolean {
    this.dropExpired();
    const own = this.entries.get(modelId);
    const otherRecords = this.size - (own?.records.length ?? 0);
    const otherBytes = this.bytes - (own?.bytes ?? 0);
    if (
      otherRecords + records.length > this.options.maxRecords ||
      otherBytes + bytes > this.maxBytes
    ) {
      this.entries.delete(modelId);
      return false;
    }
    this.entries.set(modelId, { records: [...records], fetchedAt, bytes });
    return true;
  }

  drop(modelId: string): void {
    this.entries.delete(modelId);
  }

  clear(): void {
    this.generation += 1;
    this.entries.clear();
    this.refreshing = null;
  }

  /** Resolves once no post-run refresh is in flight. Never rejects. */
  async whenRefreshed(): Promise<void> {
    while (this.refreshing) {
      const current = this.refreshing;
      // biome-ignore lint/performance/noAwaitInLoops: a refresh may be chained while waiting for the previous one.
      await current;
      if (this.refreshing === current) return;
    }
  }

  /**
   * Re-reads records by id (nested, current version) and replaces them in
   * their model's entry; ids that come back missing were deleted and are
   * removed. Models without an entry are skipped; a model whose re-read fails
   * loses its entry (the next search downloads it). Chained after any refresh
   * already in flight.
   */
  refresh(
    client: Client,
    modelFor: (modelId: string) => DiscoveryModel | undefined,
    idsByModel: ReadonlyMap<string, ReadonlyArray<string>>,
  ): Promise<void> {
    const generation = this.generation;
    const previous = this.refreshing ?? Promise.resolve();
    const task = previous.then(() =>
      this.refreshModels(client, modelFor, idsByModel, generation),
    );
    const tracked = task.finally(() => {
      if (this.refreshing === tracked) this.refreshing = null;
    });
    this.refreshing = tracked;
    return tracked;
  }

  private async refreshModels(
    client: Client,
    modelFor: (modelId: string) => DiscoveryModel | undefined,
    idsByModel: ReadonlyMap<string, ReadonlyArray<string>>,
    generation: number,
  ): Promise<void> {
    for (const [modelId, ids] of idsByModel) {
      if (generation !== this.generation) return;
      const model = modelFor(modelId);
      if (!this.entries.has(modelId) || ids.length === 0) continue;
      if (!model) {
        this.entries.delete(modelId);
        continue;
      }
      try {
        // biome-ignore lint/performance/noAwaitInLoops: one model at a time; the pool paces its requests with the searches'.
        const records = await fetchRecordsByIds(client, model, ids, {
          pool: this.options.pool,
        });
        if (generation === this.generation) {
          this.replaceRecords(modelId, ids, records);
        }
      } catch {
        if (generation === this.generation) this.entries.delete(modelId);
      }
    }
  }

  /**
   * Puts re-read records in place; ids missing from `records` are removed.
   * An entry that grows over `maxBytes` this way is dropped.
   */
  replaceRecords(
    modelId: string,
    ids: ReadonlyArray<string>,
    records: ReadonlyArray<RawNestedItem>,
  ): void {
    const entry = this.entries.get(modelId);
    if (!entry) return;
    const refreshed = new Map(records.map((record) => [record.id, record]));
    const reread = new Set(ids);
    const next: RawNestedItem[] = [];
    let bytes = entry.bytes;
    for (const record of entry.records) {
      if (!reread.has(record.id)) {
        next.push(record);
        continue;
      }
      bytes -= recordSize(record);
      const fresh = refreshed.get(record.id);
      if (fresh) {
        next.push(fresh);
        bytes += recordSize(fresh);
      }
    }
    if (this.bytes - entry.bytes + bytes > this.maxBytes) {
      this.entries.delete(modelId);
      return;
    }
    // A new array: a replay that is still iterating the old one is unaffected.
    this.entries.set(modelId, {
      records: next,
      fetchedAt: entry.fetchedAt,
      bytes,
    });
  }

  /**
   * The record source for one discovery run: fresh cached models replay from
   * memory; every other model is downloaded and, when its scan completes,
   * cached.
   */
  recordSource(options: CacheRecordSourceOptions = {}): DiscoveryRecordSource {
    // A search starts: nothing expired is kept any longer.
    this.dropExpired();
    return (model) => {
      const forced =
        options.network === 'all' || options.network?.has(model.id) === true;
      const cached = forced ? null : this.fresh(model.id);
      if (cached) {
        return replayRecordSource(cached, {
          yieldToEventLoop: options.yieldToEventLoop,
        });
      }
      return this.collectingSource(model.id);
    };
  }

  /** The network source, keeping what it delivers for the cache. */
  private collectingSource(modelId: string): ModelRecordSource {
    const generation = this.generation;
    const { maxRecords } = this.options;
    const { maxBytes } = this;

    // The run's background count, once known: a model that can't fit is
    // never collected.
    let knownCount: number | null = null;
    return {
      count: async (context) => {
        knownCount = await networkRecordSource.count(context);
        return knownCount;
      },
      scan: async (context) => {
        const startedAt = this.now();
        // Null once the model can't fit (or a resumed scan skips its start):
        // nothing more is kept for it.
        let collected: RawNestedItem[] | null = context.startOffset ? null : [];
        let collectedBytes = 0;
        await networkRecordSource.scan({
          ...context,
          onRecords: async (records) => {
            if (collected) {
              const room = this.roomFor(modelId);
              const pageBytes = recordsSize(records);
              if (
                (knownCount !== null &&
                  knownCount > Math.min(maxRecords, room.records)) ||
                collected.length + records.length >
                  Math.min(maxRecords, room.records) ||
                collectedBytes + pageBytes > Math.min(maxBytes, room.bytes)
              ) {
                collected = null;
              } else {
                collected.push(...records);
                collectedBytes += pageBytes;
              }
            }
            await context.onRecords(records);
          },
        });
        // The scan rejects when the run was capped, stopped or failed; the
        // signal check keeps that guarantee local to the cache.
        if (
          collected &&
          !context.signal.aborted &&
          generation === this.generation
        ) {
          this.store(modelId, collected, startedAt, collectedBytes);
        }
      },
    };
  }

  /** What the cache can still take for this model, next to the other entries. */
  private roomFor(modelId: string): { records: number; bytes: number } {
    const own = this.entries.get(modelId);
    return {
      records:
        this.options.maxRecords - (this.size - (own?.records.length ?? 0)),
      bytes: this.maxBytes - (this.bytes - (own?.bytes ?? 0)),
    };
  }

  private dropExpired(): void {
    for (const [modelId, entry] of this.entries) {
      if (this.isExpired(entry)) this.entries.delete(modelId);
    }
  }
}
