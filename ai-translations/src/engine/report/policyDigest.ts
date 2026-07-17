/**
 * Canonical, order-independent digest of the locked policy — the resume gate
 * (persistence §3 / recovery.isPolicyCompatible). Two semantically-identical
 * policies MUST hash equal, so the token lists are sorted before hashing and the
 * two lists are kept distinguishable.
 */
import type { PlanPolicy } from '../plan/buildPlanTypes';
import { crc32 } from './crc32';

export function policyDigest(policy: PlanPolicy): string {
  const canonical = JSON.stringify({
    excluded: [...policy.excludedTokens].sort(),
    copy: [...policy.copyTokens].sort(),
  });
  return crc32(new TextEncoder().encode(canonical)).toString(16).padStart(8, '0');
}
