/**
 * Pure recovery logic (persistence spec §3/§4): pick the freshest run-state copy
 * across tiers by the monotonic checkpoint ordinal (NOT wall-clock — device
 * clocks skew, review finding), decide which units a resume must re-run, and gate
 * resume on the policy pin.
 */
import type { RunState } from './runState';

/**
 * Picks the freshest RunState among same-run candidates from different tiers, by
 * `checkpoint` descending with `deviceId` as a deterministic tie-break. Returns
 * null for an empty list. Wall-clock `updatedAt` is deliberately ignored.
 */
export function pickLatestRunState(candidates: readonly RunState[]): RunState | null {
  let best: RunState | null = null;
  for (const candidate of candidates) {
    if (
      best === null ||
      candidate.checkpoint > best.checkpoint ||
      (candidate.checkpoint === best.checkpoint && candidate.deviceId > best.deviceId)
    ) {
      best = candidate;
    }
  }
  return best;
}

/** A unit a resume must act on (anything not already cleanly Written). */
export interface ResumeTarget {
  recordId: string;
  toLocale: string;
}

/**
 * The units a resume must re-run: everything NOT `written` — `blocked`,
 * `not-attempted`, and `written-unverified` (whose write state is unknown, so it
 * re-runs; a fresh re-read + idempotent re-write is REPLACE-not-merge-safe). §3.
 */
export function unitsToResume(state: RunState): ResumeTarget[] {
  const targets: ResumeTarget[] = [];
  for (const record of state.records) {
    for (const unit of record.units) {
      if (unit.bucket !== 'written') {
        targets.push({ recordId: record.recordId, toLocale: unit.toLocale });
      }
    }
  }
  return targets;
}

/**
 * Whether a persisted run may resume under the live policy. A digest mismatch
 * means the admin policy changed mid-run (a fate flipped, a locale de-selected);
 * resuming would run half under old rules and half under new — the caller must
 * refuse or warn. §3.
 */
export function isPolicyCompatible(state: RunState, livePolicyDigest: string): boolean {
  return state.policyDigest === livePolicyDigest;
}
