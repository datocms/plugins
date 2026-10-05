import { useRef } from 'react';
import { membershipSignature } from '../../lib/fieldValue';
import type { StoredEntry } from '../../types';

/**
 * The same entries array while the set of keys is unchanged, whatever the
 * order: reordering must not trigger a new hydration.
 */
export function useStableMembership(
  entries: readonly StoredEntry[],
): readonly StoredEntry[] {
  const signature = membershipSignature(entries);
  const ref = useRef({ signature, entries });
  if (ref.current.signature !== signature) {
    ref.current = { signature, entries };
  }
  return ref.current.entries;
}
