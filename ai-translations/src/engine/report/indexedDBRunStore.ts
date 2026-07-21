/**
 * IndexedDB-backed {@link RunStore} (persistence spec §8, durable tier). Stores
 * the serialized RunState string keyed by `runId`, reading back through the same
 * JSON adapter as {@link createInMemoryRunStore} so a load returns a fresh,
 * validated copy. This is what makes a bulk run recoverable across a browser
 * reload — the engine persists a checkpoint after each record, and a later
 * session reads it back to resume the not-yet-`written` units.
 */
import { deserializeRunState, serializeRunState } from './jsonAdapter';
import type { RunState } from './runState';
import type { RunStore, RunSummary } from './runStore';

const STORE_NAME = 'runs';

const summaryOf = (state: RunState): RunSummary => ({
  runId: state.runId,
  checkpoint: state.checkpoint,
  startedAt: state.startedAt,
  operation: state.operation,
});

/**
 * Creates a durable {@link RunStore} over IndexedDB.
 *
 * @param factory - The `IDBFactory` to open against; defaults to the ambient
 *   `indexedDB`. Injected in tests (e.g. `fake-indexeddb`).
 * @param dbName - Database name; one object store (`runs`) keyed by `runId`.
 */
export function createIndexedDBRunStore(
  factory: IDBFactory = globalThis.indexedDB,
  dbName = 'datocms-ai-translations-runs',
): RunStore {
  let dbPromise: Promise<IDBDatabase> | null = null;

  const openDb = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const req = factory.open(dbName, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE_NAME)) {
          req.result.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

  const db = (): Promise<IDBDatabase> => {
    dbPromise ??= openDb();
    return dbPromise;
  };

  /**
   * Runs one request in its own transaction, resolving on `oncomplete` (so a
   * write is durable before we return) with the request's result.
   */
  const run = async <T>(
    mode: IDBTransactionMode,
    request: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const database = await db();
    return new Promise<T>((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, mode);
      const req = request(tx.objectStore(STORE_NAME));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };

  const allStates = async (): Promise<RunState[]> => {
    const rows = await run<string[]>(
      'readonly',
      (store) => store.getAll() as IDBRequest<string[]>,
    );
    return (rows ?? []).map((json) => deserializeRunState(json));
  };

  return {
    async save(state) {
      await run('readwrite', (store) =>
        store.put(serializeRunState(state), state.runId),
      );
    },

    async load(runId) {
      const json = await run<string | undefined>(
        'readonly',
        (store) => store.get(runId) as IDBRequest<string | undefined>,
      );
      return json ? deserializeRunState(json) : null;
    },

    async latest() {
      let best: RunState | null = null;
      for (const state of await allStates()) {
        if (best === null || state.startedAt > best.startedAt) best = state;
      }
      return best;
    },

    async list() {
      return (await allStates()).map(summaryOf);
    },

    async delete(runId) {
      await run('readwrite', (store) => store.delete(runId));
    },
  };
}
