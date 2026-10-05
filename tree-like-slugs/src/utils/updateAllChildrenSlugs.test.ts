import type { Client } from '@datocms/cma-client-browser';
import { describe, expect, it, vi } from 'vitest';
import updateAllChildrenSlugs from './updateAllChildrenSlugs';

type FakeRecord = {
  id: string;
  parent_id: string | null;
  slug: unknown;
  meta: { current_version: string };
};

function fakeClient(records: FakeRecord[]) {
  const update = vi.fn(async (id: string, body: Record<string, unknown>) => {
    const record = records.find((candidate) => candidate.id === id);
    if (record) record.slug = body.slug;
  });
  const listPagedIterator = vi.fn(async function* (query: {
    filter: { fields: { parent: { eq: string } } };
  }) {
    const parentId = query.filter.fields.parent.eq;
    yield* records.filter((record) => record.parent_id === parentId);
  });
  const client = { items: { listPagedIterator, update } };
  return { client: client as unknown as Client, update };
}

function record(id: string, parentId: string | null, slug: unknown) {
  return {
    id,
    parent_id: parentId,
    slug,
    meta: { current_version: `v-${id}` },
  };
}

describe('updateAllChildrenSlugs', () => {
  it('prefixes every descendant with its parent slug', async () => {
    const records = [
      record('child', 'root', 'old/child'),
      record('grandchild', 'child', 'old/child/grandchild'),
      record('sibling', 'root', 'old/sibling'),
    ];
    const { client, update } = fakeClient(records);

    await updateAllChildrenSlugs(client, 'model', 'root', 'slug', 'new');

    expect(records.map((item) => item.slug)).toEqual([
      'new/child',
      'new/child/grandchild',
      'new/sibling',
    ]);
    expect(update).toHaveBeenCalledWith('child', {
      slug: 'new/child',
      meta: { current_version: 'v-child' },
    });
  });

  it('updates localized slugs and stops a branch where a locale is missing', async () => {
    const records = [
      record('child', 'root', { en: 'old/child', it: null }),
      record('grandchild', 'child', { en: 'old/child/leaf', it: 'foglia' }),
    ];
    const { client } = fakeClient(records);

    await updateAllChildrenSlugs(client, 'model', 'root', 'slug', {
      en: 'new',
      it: 'nuovo',
    });

    expect(records[0].slug).toEqual({ en: 'new/child', it: null });
    expect(records[1].slug).toEqual({ en: 'new/child/leaf', it: 'foglia' });
  });

  it('skips writes for children that already have the right slug', async () => {
    const { client, update } = fakeClient([
      record('child', 'root', 'new/child'),
    ]);

    await updateAllChildrenSlugs(client, 'model', 'root', 'slug', 'new');

    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a cycle instead of looping forever', async () => {
    const { client } = fakeClient([
      record('a', 'root', 'old/a'),
      record('root', 'a', 'old'),
    ]);

    await expect(
      updateAllChildrenSlugs(client, 'model', 'root', 'slug', 'new'),
    ).rejects.toThrow('cycle');
  });
});
