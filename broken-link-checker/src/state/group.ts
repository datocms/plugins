import { cacheGroupFacts, groupFacts } from '../report/view';
import type { LinkGroup } from '../types';

/** Preserve a lazy location snapshot without retaining a chain of older groups. */
export function updateGroup(
  group: LinkGroup,
  changes: Partial<Pick<LinkGroup, 'stale' | 'result'>>,
): LinkGroup {
  const next: LinkGroup = {
    key: group.key,
    prepared: group.prepared,
    result: changes.result ?? group.result,
    stale: changes.stale ?? group.stale,
    occurrences: [],
  };
  const locations = Object.getOwnPropertyDescriptor(group, 'occurrences');
  if (locations) Object.defineProperty(next, 'occurrences', locations);
  else next.occurrences = group.occurrences;
  cacheGroupFacts(next, groupFacts(group));
  return next;
}
