/**
 * Decides whether a prior bulk run can be resumed (persistence spec §8, step 4).
 * A run is resumable only when it exists, its policy still matches the current
 * config (an admin flipping a fate / de-selecting a locale invalidates it), and
 * it has at least one unit that never reached `written`.
 */
import {
  isPolicyCompatible,
  type ResumeTarget,
  unitsToResume,
} from './recovery';
import type { RunState } from './runState';

export type ResumeDecision =
  | { kind: 'none' }
  | { kind: 'resumable'; priorState: RunState; targets: ResumeTarget[] };

/**
 * @param prior - The most recent prior run (`store.latest()`), or `null`.
 * @param currentPolicyDigest - `policyDigest(currentPolicy)` for the live config.
 */
export const decideResume = (
  prior: RunState | null,
  currentPolicyDigest: string,
): ResumeDecision => {
  if (!prior) return { kind: 'none' };
  if (!isPolicyCompatible(prior, currentPolicyDigest)) return { kind: 'none' };
  const targets = unitsToResume(prior);
  return targets.length > 0
    ? { kind: 'resumable', priorState: prior, targets }
    : { kind: 'none' };
};
