import { describe, expect, it } from 'vitest';
import type { LinkGroup } from '../types';
import { updateGroup } from './group';

describe('updateGroup', () => {
  it('shares plain immutable location arrays across stale and result changes', () => {
    const group: LinkGroup = {
      key: 'one',
      prepared: { key: 'one', url: '/one', status: 'skipped', message: '' },
      result: { key: 'one', url: '/one', status: 'skipped', message: '' },
      occurrences: [],
      stale: false,
    };
    const stale = updateGroup(group, { stale: true });
    expect(stale.stale).toBe(true);
    expect(group.stale).toBe(false);
    expect(stale.occurrences).toBe(group.occurrences);
  });
});
