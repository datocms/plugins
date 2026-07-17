/**
 * Storage-tier abstraction for run artifacts (persistence spec §8 step 5). A
 * `RunStore` persists/loads RunState through the JSON adapter, so every tier
 * (in-memory, IndexedDB, cloud) shares one serialization path. The IndexedDB and
 * cloud bindings implement this same interface; the in-memory store here is the
 * testable reference and the live working tier.
 */
import { deserializeRunState, serializeRunState } from './jsonAdapter';
import type { RunState } from './runState';

export interface RunSummary {
  runId: string;
  checkpoint: number;
  startedAt: number;
  operation: string;
}

export interface RunStore {
  save(state: RunState): Promise<void>;
  load(runId: string): Promise<RunState | null>;
  /** The most recently STARTED run (to resume the current one). */
  latest(): Promise<RunState | null>;
  list(): Promise<RunSummary[]>;
  delete(runId: string): Promise<void>;
}

/**
 * In-memory RunStore. Stores the serialized form (not the live object) so it
 * exercises the same serialize/deserialize round-trip as the durable tiers —
 * a load returns a fresh, validated copy, never a shared mutable reference.
 */
export function createInMemoryRunStore(): RunStore {
  const byId = new Map<string, string>();

  const all = (): RunState[] => [...byId.values()].map((json) => deserializeRunState(json));

  return {
    async save(state) {
      byId.set(state.runId, serializeRunState(state));
    },
    async load(runId) {
      const json = byId.get(runId);
      return json ? deserializeRunState(json) : null;
    },
    async latest() {
      let best: RunState | null = null;
      for (const state of all()) {
        if (best === null || state.startedAt > best.startedAt) best = state;
      }
      return best;
    },
    async list() {
      return all().map((s) => ({
        runId: s.runId,
        checkpoint: s.checkpoint,
        startedAt: s.startedAt,
        operation: s.operation,
      }));
    },
    async delete(runId) {
      byId.delete(runId);
    },
  };
}
