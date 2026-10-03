import { describe, expect, it, vi } from 'vitest';
import { cacheGroupFacts, groupFacts } from '../report/view';
import type { LinkGroup } from '../types';
import { updateGroup } from './group';

describe('updateGroup', () => {
  it('keeps repeated UI updates lazy without nesting location getters', () => {
    const locations: LinkGroup['occurrences'] = [
      {
        id: 'one',
        recordId: 'record-1',
        recordTitle: 'Article',
        modelId: 'article',
        modelName: 'Article',
        fieldPath: 'url',
        fieldLabel: 'URL',
        blockPath: [],
        url: 'https://example.test/',
      },
    ];
    const plain: LinkGroup = {
      key: 'https://example.test/',
      prepared: {
        key: 'https://example.test/',
        url: 'https://example.test/',
        status: 'queued',
        message: '',
      },
      result: {
        key: 'https://example.test/',
        url: 'https://example.test/',
        status: 'reachable',
        message: '',
      },
      occurrences: locations,
      stale: false,
    };
    const read = vi.fn(() => locations);
    const original: LinkGroup = {
      ...plain,
      get occurrences() {
        return read();
      },
    };
    const facts = groupFacts(plain);
    cacheGroupFacts(original, facts);
    let group = original;
    for (let index = 0; index < 10_000; index += 1)
      group = updateGroup(group, {
        result: { ...plain.result, message: `Check ${index}` },
      });
    expect(read).not.toHaveBeenCalled();
    expect(groupFacts(group)).toBe(facts);
    expect(group.occurrences).toBe(locations);
    expect(read).toHaveBeenCalledOnce();
    expect(group.result.message).toBe('Check 9999');
    expect(original.result.message).toBe('');
  });

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
