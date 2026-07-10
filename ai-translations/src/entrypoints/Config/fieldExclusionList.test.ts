import { describe, expect, it } from 'vitest';
import { buildFieldListEntries, mergeUniqueFields } from './fieldExclusionList';

const field = (id: string, label: string) => ({ id, attributes: { label } });

describe('buildFieldListEntries', () => {
  it('labels a regular model field with the model name', () => {
    const entries = buildFieldListEntries(
      [field('f1', 'Title')],
      { attributes: { name: 'Article', modular_block: false } },
    );
    expect(entries).toEqual([{ id: 'f1', name: 'Title', model: 'Article' }]);
  });

  it('includes block fields and marks them as "<name> block"', () => {
    // The customer bug: a field inside a block must appear in the picker so it
    // can be excluded. Block item types are enumerated like any other.
    const entries = buildFieldListEntries(
      [field('b1', 'Heading'), field('b2', 'Body')],
      { attributes: { name: 'Hero', modular_block: true } },
    );
    expect(entries).toEqual([
      { id: 'b1', name: 'Heading', model: 'Hero block' },
      { id: 'b2', name: 'Body', model: 'Hero block' },
    ]);
  });

  it('tolerates a missing item type / name without emitting "undefined"', () => {
    expect(buildFieldListEntries([field('f1', 'X')], undefined)).toEqual([
      { id: 'f1', name: 'X', model: '' },
    ]);
    expect(
      buildFieldListEntries([field('f1', 'X')], {
        attributes: { modular_block: true },
      }),
    ).toEqual([{ id: 'f1', name: 'X', model: ' block' }]);
  });
});

describe('mergeUniqueFields', () => {
  it('appends only fields whose id is not already present', () => {
    const prev = [{ id: 'a', name: 'A', model: 'M' }];
    const next = [
      { id: 'a', name: 'A', model: 'M' },
      { id: 'b', name: 'B', model: 'M' },
    ];
    expect(mergeUniqueFields(prev, next)).toEqual([
      { id: 'a', name: 'A', model: 'M' },
      { id: 'b', name: 'B', model: 'M' },
    ]);
  });
});
