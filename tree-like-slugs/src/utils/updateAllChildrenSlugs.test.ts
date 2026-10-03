import { describe, expect, it } from 'vitest';
import updateAllChildrenSlugs, {
  PropagationError,
  type PropagationProgress,
  type SlugChanges,
  type TreeClient,
  type TreeListQuery,
  type TreeRecord,
} from './updateAllChildrenSlugs';

const MODEL = 'page-model';
const ROOT = 'root';
const NO_WAIT = { wait: async () => undefined, random: () => 0 };
type UpdateBody = Parameters<TreeClient['items']['rawUpdate']>[1];
type Page = Awaited<ReturnType<TreeClient['items']['rawList']>>;
type Write = { id: string; body: UpdateBody };

function record(
  id: string,
  parent: string | null = null,
  attributes: Record<string, unknown> = { slug: `old/${id}` },
): TreeRecord {
  return {
    id,
    attributes: { ...attributes, parent_id: parent },
    relationships: { item_type: { data: { id: MODEL } } },
    meta: { current_version: '1' },
  };
}

function copy(value: TreeRecord): TreeRecord {
  return {
    ...value,
    attributes: { ...value.attributes },
    relationships: {
      item_type: { data: { ...value.relationships.item_type.data } },
    },
    meta: { ...value.meta },
  };
}

function httpError(status: number, code?: string): Error {
  return Object.assign(
    new Error('API failure containing private request data'),
    {
      response: {
        status,
        body: { data: code ? [{ attributes: { code } }] : [] },
      },
    },
  );
}

function deferred() {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function failure(operation: Promise<PropagationProgress>) {
  try {
    await operation;
  } catch (error) {
    if (error instanceof PropagationError) return error;
    throw error;
  }
  throw new Error('Expected propagation to fail.');
}

class FakeTree {
  readonly records: Map<string, TreeRecord>;
  readonly ids: string[];
  readonly queries: TreeListQuery[] = [];
  readonly finds: string[] = [];
  readonly attempts: Write[] = [];
  readonly writes: Write[] = [];
  active = 0;
  maxActive = 0;
  beforeList?: (query: TreeListQuery) => Promise<void> | void;
  beforeFind?: (id: string) => Promise<void> | void;
  beforeUpdate?: (write: Write) => Promise<void> | void;
  afterUpdate?: (write: Write, response: TreeRecord) => Promise<void> | void;
  page?: (query: TreeListQuery, data: TreeRecord[]) => Page;

  constructor(records: TreeRecord[]) {
    this.records = new Map(records.map((item) => [item.id, copy(item)]));
    this.ids = [...this.records.keys()].sort();
  }

  get(id: string): TreeRecord {
    const value = this.records.get(id);
    if (!value) throw new Error(`Fixture has no record ${id}.`);
    return copy(value);
  }

  change(id: string, attributes: Record<string, unknown> = {}) {
    const value = this.get(id);
    this.records.set(id, {
      ...value,
      attributes: { ...value.attributes, ...attributes },
      meta: {
        ...value.meta,
        current_version: String(Number(value.meta.current_version) + 1),
      },
    });
  }

  apply(write: Write): TreeRecord {
    const value = this.get(write.id);
    if (value.meta.current_version !== write.body.data.meta.current_version) {
      throw httpError(409, 'STALE_ITEM_VERSION');
    }
    this.writes.push(write);
    this.change(write.id, write.body.data.attributes);
    return this.get(write.id);
  }

  private async tracked<T>(operation: () => Promise<T>): Promise<T> {
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      return await operation();
    } finally {
      this.active--;
    }
  }

  readonly client: TreeClient = {
    items: {
      rawList: (query) =>
        this.tracked(async () => {
          this.queries.push(query);
          await this.beforeList?.(query);
          const data = this.ids
            .slice(query.page.offset, query.page.offset + query.page.limit)
            .map((id) => this.get(id));
          return (
            this.page?.(query, data) ?? {
              data,
              meta: { total_count: this.ids.length },
            }
          );
        }),
      rawFind: (id) =>
        this.tracked(async () => {
          this.finds.push(id);
          await this.beforeFind?.(id);
          return { data: this.get(id) };
        }),
      rawUpdate: (id, body) =>
        this.tracked(async () => {
          const write = { id, body };
          this.attempts.push(write);
          await this.beforeUpdate?.(write);
          const data = this.apply(write);
          await this.afterUpdate?.(write, data);
          return { data };
        }),
    },
  };
}

function simpleTree(children = 1): FakeTree {
  return new FakeTree([
    record(ROOT),
    ...Array.from({ length: children }, (_, index) =>
      record(`child-${index}`, ROOT),
    ),
  ]);
}

function run(tree: FakeTree, prefixes: SlugChanges = { slug: 'new' }) {
  return updateAllChildrenSlugs(
    tree.client,
    MODEL,
    tree.get(ROOT),
    prefixes,
    NO_WAIT,
  );
}

describe('complete paginated tree propagation', () => {
  it('updates more than 500 children across 100-record pages with precise progress', async () => {
    const tree = simpleTree(537);
    const progress: PropagationProgress[] = [];
    const result = await updateAllChildrenSlugs(
      tree.client,
      MODEL,
      tree.get(ROOT),
      { slug: 'new' },
      { ...NO_WAIT, onProgress: (value) => progress.push(value) },
    );

    expect(tree.queries.map((query) => query.page.offset)).toEqual([
      0, 100, 200, 300, 400, 500,
    ]);
    for (const query of tree.queries) {
      expect(query).toEqual({
        filter: { type: MODEL },
        page: { limit: 100, offset: query.page.offset },
        nested: false,
        version: 'current',
        order_by: 'id_ASC',
      });
    }
    expect(result).toEqual({
      phase: 'complete',
      scanned: 538,
      modelTotal: 538,
      total: 537,
      processed: 537,
      updated: 537,
      unchanged: 0,
    });
    expect(tree.writes).toHaveLength(537);
    expect(progress[progress.length - 1]).toEqual(result);
    for (let index = 1; index < progress.length; index++) {
      expect(progress[index].scanned).toBeGreaterThanOrEqual(
        progress[index - 1].scanned,
      );
      expect(progress[index].processed).toBeGreaterThanOrEqual(
        progress[index - 1].processed,
      );
      expect(progress[index].updated + progress[index].unchanged).toBe(
        progress[index].processed,
      );
    }
    expect(tree.get('child-536').attributes.slug).toBe('new/child-536');
  });

  it('generates a 200,000-record wide fixture on demand and processes every descendant', async () => {
    // No fixture array or full response is prebuilt: only pages and small write state exist.
    const count = 200_000;
    const rootId = 'r000000';
    const changed = new Map<string, string>();
    let pages = 0;
    let finds = 0;
    let writes = 0;
    let active = 0;
    let maxActive = 0;
    const make = (index: number) =>
      record(
        `r${String(index).padStart(6, '0')}`,
        index === 0 ? null : rootId,
        { slug: index === 0 ? 'root' : `old/child-${index}` },
      );
    async function tracked<T>(operation: () => T): Promise<T> {
      active++;
      maxActive = Math.max(maxActive, active);
      try {
        await Promise.resolve();
        return operation();
      } finally {
        active--;
      }
    }
    const client: TreeClient = {
      items: {
        rawList: (query) =>
          tracked(() => {
            pages++;
            return {
              data: Array.from(
                {
                  length: Math.min(query.page.limit, count - query.page.offset),
                },
                (_, index) => make(query.page.offset + index),
              ),
              meta: { total_count: count },
            };
          }),
        rawFind: (id) =>
          tracked(() => {
            finds++;
            const value = make(Number(id.slice(1)));
            const slug = changed.get(id);
            if (slug !== undefined) {
              value.attributes.slug = slug;
              value.meta.current_version = '2';
            }
            return { data: value };
          }),
        rawUpdate: (id, body) =>
          tracked(() => {
            const slug = body.data.attributes.slug;
            if (
              typeof slug !== 'string' ||
              body.data.meta.current_version !== '1' ||
              changed.has(id)
            ) {
              throw new Error('Invalid or duplicate synthetic write.');
            }
            writes++;
            changed.set(id, slug);
            const value = make(Number(id.slice(1)));
            value.attributes.slug = slug;
            value.meta.current_version = '2';
            return { data: value };
          }),
      },
    };

    const result = await updateAllChildrenSlugs(
      client,
      MODEL,
      make(0),
      { slug: 'new' },
      NO_WAIT,
    );

    expect(result).toEqual({
      phase: 'complete',
      scanned: count,
      modelTotal: count,
      total: count - 1,
      processed: count - 1,
      updated: count - 1,
      unchanged: 0,
    });
    expect(pages).toBe(2_000);
    expect(finds).toBeGreaterThanOrEqual(count);
    expect(writes).toBe(count - 1);
    expect(changed.get('r199999')).toBe('new/child-199999');
    expect(maxActive).toBe(4);
    expect(active).toBe(0);
  }, 180_000);

  it('processes a 12,000-level chain iteratively without retaining quadratic fixture paths', async () => {
    const depth = 12_000;
    let updated = 0;
    let lastPathLength = 0;
    let lastWrittenId = '';
    let lastWrittenSlug = '';
    const make = (index: number) =>
      record(
        `r${String(index).padStart(5, '0')}`,
        index === 0 ? null : `r${String(index - 1).padStart(5, '0')}`,
        { slug: index === 0 ? 'root' : 'old/x' },
      );
    const client: TreeClient = {
      items: {
        rawList: async (query) => ({
          data: Array.from(
            {
              length: Math.min(query.page.limit, depth + 1 - query.page.offset),
            },
            (_, index) => make(query.page.offset + index),
          ),
          meta: { total_count: depth + 1 },
        }),
        rawFind: async (id) => {
          const value = make(Number(id.slice(1)));
          if (id === lastWrittenId) {
            value.attributes.slug = lastWrittenSlug;
            value.meta.current_version = '2';
          }
          return { data: value };
        },
        rawUpdate: async (id, body) => {
          const slug = body.data.attributes.slug;
          if (typeof slug !== 'string' || Number(id.slice(1)) !== updated + 1) {
            throw new Error('A descendant was written before its parent.');
          }
          updated++;
          lastPathLength = slug.length;
          // Do not keep every ancestor path in this deep-tree fixture.
          lastWrittenId = id;
          lastWrittenSlug = slug;
          const value = make(Number(id.slice(1)));
          value.attributes.slug = slug;
          value.meta.current_version = '2';
          return { data: value };
        },
      },
    };

    const result = await updateAllChildrenSlugs(
      client,
      MODEL,
      make(0),
      { slug: 'new' },
      NO_WAIT,
    );

    expect(result.updated).toBe(depth);
    expect(result.processed).toBe(depth);
    expect(updated).toBe(depth);
    expect(lastPathLength).toBe('new'.length + depth * 2);
  }, 180_000);

  it('updates mixed branches only after their parent, regardless of page ordering', async () => {
    const tree = new FakeTree([
      record(ROOT),
      record('z-parent', ROOT),
      record('a-grandchild', 'z-parent'),
      record('b-deep-child', 'a-grandchild'),
      record('y-parent', ROOT),
      record('c-grandchild', 'y-parent'),
      record('unrelated'),
    ]);
    const result = await run(tree);
    const order = tree.writes.map(({ id }) => id);
    expect(order.indexOf('z-parent')).toBeLessThan(
      order.indexOf('a-grandchild'),
    );
    expect(order.indexOf('a-grandchild')).toBeLessThan(
      order.indexOf('b-deep-child'),
    );
    expect(order.indexOf('y-parent')).toBeLessThan(
      order.indexOf('c-grandchild'),
    );
    expect(tree.get('b-deep-child').attributes.slug).toBe(
      'new/z-parent/a-grandchild/b-deep-child',
    );
    expect(tree.get('unrelated').attributes.slug).toBe('old/unrelated');
    expect(result.total).toBe(5);
  });

  it('keeps the total simultaneous read and write operations at four', async () => {
    const tree = simpleTree(31);
    await run(tree);
    expect(tree.maxActive).toBe(4);
    expect(tree.active).toBe(0);
  });

  it('avoids scanning a known leaf unless validating a new parent', async () => {
    const tree = simpleTree(0);
    const root = tree.get(ROOT);
    root.meta.has_children = false;
    const result = await updateAllChildrenSlugs(
      tree.client,
      MODEL,
      root,
      { slug: 'new' },
      NO_WAIT,
    );
    expect(tree.queries).toHaveLength(0);
    expect(tree.finds).toEqual([ROOT]);
    expect(result.total).toBe(0);
    await updateAllChildrenSlugs(
      tree.client,
      MODEL,
      root,
      {},
      { ...NO_WAIT, newParent: null },
    );
    expect(tree.queries).toHaveLength(1);
  });
});

describe('tree snapshot and cycle safety', () => {
  it.each([
    ['self parent', [record(ROOT, ROOT)]],
    [
      'two-record cycle through root',
      [record(ROOT, 'child'), record('child', ROOT)],
    ],
    [
      'cyclic ancestor chain',
      [record(ROOT, 'a'), record('a', 'b'), record('b', 'a')],
    ],
  ])('rejects %s before writing', async (_name, records) => {
    const tree = new FakeTree(records);
    const error = await failure(run(tree));
    expect(error.message).toMatch(/cycle/i);
    expect(error.progress.processed).toBe(0);
    expect(tree.attempts).toHaveLength(0);
  });

  it.each([
    ROOT,
    'child-0',
    'grandchild',
  ])('rejects a proposed parent %s in the root subtree before writes', async (newParent) => {
    const tree = new FakeTree([
      record(ROOT),
      record('child-0', ROOT),
      record('grandchild', 'child-0'),
    ]);
    const error = await failure(
      updateAllChildrenSlugs(
        tree.client,
        MODEL,
        tree.get(ROOT),
        { slug: 'new' },
        { ...NO_WAIT, newParent },
      ),
    );
    expect(error.message).toMatch(/cycle/i);
    expect(tree.attempts).toHaveLength(0);
  });

  it('rejects a missing ancestor before writes', async () => {
    const tree = new FakeTree([record(ROOT, 'missing'), record('child', ROOT)]);
    const error = await failure(run(tree));
    expect(error.message).toMatch(/parent record is missing/i);
    expect(tree.attempts).toHaveLength(0);
  });

  it.each([
    'changed count',
    'duplicate record',
    'empty middle page',
  ] as const)('rejects %s in pagination before writes', async (problem) => {
    const tree = simpleTree(204);
    tree.page = (query, data) => {
      if (query.page.offset === 100) {
        if (problem === 'changed count')
          return { data, meta: { total_count: 206 } };
        if (problem === 'duplicate record') data[0] = tree.get(tree.ids[0]);
        if (problem === 'empty middle page') data = [];
      }
      return { data, meta: { total_count: 205 } };
    };
    const error = await failure(run(tree));
    expect(error.message).toMatch(/changed|twice|incomplete/i);
    expect(error.progress.scanned).toBe(100);
    expect(tree.attempts).toHaveLength(0);
  });

  it('rejects a root version that changed while pages were loaded', async () => {
    const tree = simpleTree();
    const root = tree.get(ROOT);
    tree.beforeList = () => tree.change(ROOT);
    const error = await failure(
      updateAllChildrenSlugs(
        tree.client,
        MODEL,
        root,
        { slug: 'new' },
        NO_WAIT,
      ),
    );
    expect(error.message).toMatch(/parent record changed/i);
    expect(tree.attempts).toHaveLength(0);
  });

  it('rejects a descendant reparented between scan and read', async () => {
    const tree = simpleTree();
    tree.beforeFind = (id) => {
      if (id === 'child-0') tree.change(id, { parent_id: null });
    };
    const error = await failure(run(tree));
    expect(error.message).toMatch(/changed during slug propagation/i);
    expect(tree.attempts).toHaveLength(0);
  });
});

describe('slug fields and data preservation', () => {
  it('uses parent_id for the hierarchy and preserves unrelated custom parent fields', async () => {
    const childAttributes = { slug: 'old/child', parent: { en: 'Content' } };
    const tree = new FakeTree([
      record(ROOT, null, { slug: 'old', parent: 'child' }),
      record('child', ROOT, childAttributes),
      record('unrelated', null, { slug: 'untouched', parent: ROOT }),
    ]);
    const result = await run(tree);
    expect(result).toMatchObject({ total: 1, processed: 1, updated: 1 });
    expect(tree.get(ROOT).attributes.parent).toBe('child');
    expect(tree.get('child').attributes).toEqual({
      ...childAttributes,
      slug: 'new/child',
      parent_id: ROOT,
    });
    expect(tree.get('unrelated').attributes).toEqual({
      slug: 'untouched',
      parent: ROOT,
      parent_id: null,
    });
    expect(tree.writes).toHaveLength(1);
    expect(tree.writes[0].body.data.attributes).toEqual({ slug: 'new/child' });
  });

  it('preserves other attributes and locales while propagating multiple slug fields', async () => {
    const richAttributes = {
      slug: 'old/child',
      localized_slug: {
        en: 'old/en-child',
        pt: 'velho/pt-child',
        fr: 'leave/fr-child',
        de: null,
      },
      title: { en: 'A title', pt: 'Um título' },
      cover: { upload_id: 'asset-1', alt: 'Cover' },
      references: ['record-1', 'record-2'],
      blocks: ['nested-block-1'],
      structured_text: {
        schema: 'dast',
        document: { type: 'root', children: [] },
      },
    };
    const tree = new FakeTree([
      record(ROOT),
      record('child', ROOT, richAttributes),
    ]);
    await run(tree, {
      slug: 'new',
      localized_slug: { en: 'new/en', pt: 'novo/pt' },
    });
    expect(tree.get('child').attributes).toEqual({
      ...richAttributes,
      parent_id: ROOT,
      slug: 'new/child',
      localized_slug: {
        en: 'new/en/en-child',
        pt: 'novo/pt/pt-child',
        fr: 'leave/fr-child',
        de: null,
      },
    });
    expect(tree.writes[0].body.data.attributes).toEqual({
      slug: 'new/child',
      localized_slug: {
        en: 'new/en/en-child',
        pt: 'novo/pt/pt-child',
        fr: 'leave/fr-child',
        de: null,
      },
    });
  });

  it('counts unchanged string and localized slugs without writes', async () => {
    const tree = new FakeTree([
      record(ROOT),
      record('child', ROOT, {
        slug: 'new/child',
        localized_slug: { en: 'new/child', fr: 'untouched' },
      }),
    ]);
    const result = await run(tree, {
      slug: 'new',
      localized_slug: { en: 'new' },
    });
    expect(result).toMatchObject({ processed: 1, updated: 0, unchanged: 1 });
    expect(tree.attempts).toHaveLength(0);
  });

  it('stops a missing or null locale on its branch while propagating other locales', async () => {
    const tree = new FakeTree([
      record(ROOT),
      record('a', ROOT, { slug: { en: 'old/a', pt: null, fr: 'old/fr-a' } }),
      record('b', 'a', {
        slug: { en: 'old/b', pt: 'preserve/pt-b', fr: 'preserve/fr-b' },
      }),
      record('c', ROOT, { slug: { en: null, fr: 'old/fr-c' } }),
      record('d', 'c', { slug: { en: 'preserve/en-d', pt: 'preserve/pt-d' } }),
    ]);
    const result = await run(tree, { slug: { en: 'new', pt: 'novo' } });
    expect(tree.get('a').attributes.slug).toEqual({
      en: 'new/a',
      pt: null,
      fr: 'old/fr-a',
    });
    expect(tree.get('b').attributes.slug).toEqual({
      en: 'new/a/b',
      pt: 'preserve/pt-b',
      fr: 'preserve/fr-b',
    });
    expect(tree.get('c').attributes.slug).toEqual({ en: null, fr: 'old/fr-c' });
    expect(tree.get('d').attributes.slug).toEqual({
      en: 'preserve/en-d',
      pt: 'preserve/pt-d',
    });
    expect(result).toMatchObject({ updated: 2, unchanged: 2, processed: 4 });
  });

  it('stops a null scalar slug branch without manufacturing descendant paths', async () => {
    const tree = new FakeTree([
      record(ROOT),
      record('child', ROOT, { slug: null }),
      record('grandchild', 'child', { slug: 'leave/path' }),
    ]);
    const result = await run(tree);
    expect(tree.attempts).toHaveLength(0);
    expect(tree.get('grandchild').attributes.slug).toBe('leave/path');
    expect(result.unchanged).toBe(2);
  });

  it('validates malformed deep descendants before updating otherwise valid siblings', async () => {
    const tree = new FakeTree([
      record(ROOT),
      record('a-valid', ROOT),
      record('b-parent', ROOT),
      record('c-invalid', 'b-parent', { slug: { en: 42 } }),
    ]);
    const error = await failure(run(tree));
    expect(error.message).toMatch(/invalid|incompatible/i);
    expect(tree.attempts).toHaveLength(0);
    expect(error.progress.processed).toBe(0);
  });

  it('never includes 10,000 asset references or hundreds of unaffected locales in a scalar slug write', async () => {
    const gallery = Array.from({ length: 10_000 }, (_, index) => ({
      upload_id: `asset-${index}`,
    }));
    const titles = Object.fromEntries(
      Array.from({ length: 300 }, (_, index) => [
        `locale-${index}`,
        `Title ${index}`,
      ]),
    );
    const tree = new FakeTree([
      record(ROOT),
      record('child', ROOT, {
        slug: 'old/child',
        gallery,
        titles,
        blocks: ['block-a', 'block-b'],
      }),
    ]);
    const result = await run(tree);
    expect(result.updated).toBe(1);
    expect(tree.writes[0].body.data.attributes).toEqual({ slug: 'new/child' });
    expect(tree.get('child').attributes).toMatchObject({
      gallery,
      titles,
      blocks: ['block-a', 'block-b'],
    });
  });

  it.each([
    ['invalid slug value', { slug: ['not-a-slug'] }, { slug: 'new' }],
    [
      'localized child under scalar prefix',
      { slug: { en: 'old/child' } },
      { slug: 'new' },
    ],
    [
      'scalar child under localized prefix',
      { slug: 'old/child' },
      { slug: { en: 'new' } },
    ],
  ])('rejects %s without writing', async (_name, attributes, prefixes) => {
    const tree = new FakeTree([
      record(ROOT),
      record('child', ROOT, attributes),
    ]);
    const error = await failure(run(tree, prefixes));
    expect(error.message).toMatch(/invalid slug|incompatible/i);
    expect(tree.attempts).toHaveLength(0);
  });
});

describe('retries, optimistic concurrency and partial failures', () => {
  it('retries transient reads automatically and honors server backoff', async () => {
    const tree = simpleTree();
    const delays: number[] = [];
    let listAttempts = 0;
    let childFindAttempts = 0;
    tree.beforeList = () => {
      if (listAttempts++ === 0) throw httpError(503);
    };
    tree.beforeFind = (id) => {
      if (id === 'child-0' && childFindAttempts++ === 0) {
        throw Object.assign(httpError(429), {
          response: { status: 429, headers: { 'retry-after': '2' } },
        });
      }
    };
    const result = await updateAllChildrenSlugs(
      tree.client,
      MODEL,
      tree.get(ROOT),
      { slug: 'new' },
      {
        random: () => 0,
        wait: async (milliseconds) => {
          delays.push(milliseconds);
        },
      },
    );
    expect(result.updated).toBe(1);
    expect(delays).toEqual([800, 2_000]);
    expect(tree.attempts).toHaveLength(1);
  });

  it('reconciles a successful write with a lost response without a duplicate write', async () => {
    const tree = simpleTree();
    tree.beforeUpdate = (write) => {
      tree.apply(write);
      throw new TypeError('The connection was lost after commit.');
    };
    const result = await run(tree);
    expect(result).toMatchObject({ processed: 1, updated: 1, unchanged: 0 });
    expect(tree.attempts).toHaveLength(1);
    expect(tree.writes).toHaveLength(1);
    expect(tree.finds.filter((id) => id === 'child-0')).toHaveLength(2);
    expect(tree.get('child-0').meta.current_version).toBe('2');
  });

  it('retries uncommitted transient writes with the same version and increasing backoff', async () => {
    const tree = simpleTree();
    const delays: number[] = [];
    tree.beforeUpdate = () => {
      if (tree.attempts.length < 3) throw httpError(503);
    };
    const result = await updateAllChildrenSlugs(
      tree.client,
      MODEL,
      tree.get(ROOT),
      { slug: 'new' },
      {
        random: () => 0,
        wait: async (milliseconds) => {
          delays.push(milliseconds);
        },
      },
    );
    expect(result.updated).toBe(1);
    expect(delays).toEqual([800, 1_600]);
    expect(
      tree.attempts.map(({ body }) => body.data.meta.current_version),
    ).toEqual(['1', '1', '1']);
    expect(tree.writes).toHaveLength(1);
  });

  it('rejects stale writes and preserves the concurrent edit', async () => {
    const tree = simpleTree();
    tree.beforeUpdate = ({ id }) => {
      tree.change(id, { slug: 'concurrent/edit', title: 'Preserved edit' });
      throw httpError(409, 'STALE_ITEM_VERSION');
    };
    const error = await failure(run(tree));
    expect(error.message).toMatch(/changed during slug propagation/i);
    expect(tree.attempts).toHaveLength(1);
    expect(tree.writes).toHaveLength(0);
    expect(tree.get('child-0').attributes).toMatchObject({
      slug: 'concurrent/edit',
      title: 'Preserved edit',
    });
    expect(error.progress).toMatchObject({ processed: 0, updated: 0 });
  });

  it('detects an intermediate parent edited after its write before changing its children', async () => {
    const tree = new FakeTree([
      record(ROOT),
      record('child', ROOT),
      record('grandchild', 'child'),
    ]);
    tree.afterUpdate = ({ id }) => {
      if (id === 'child') tree.change(id, { slug: 'concurrent/parent' });
    };
    const error = await failure(run(tree));
    expect(error.message).toMatch(/changed during slug propagation/i);
    expect(error.progress).toMatchObject({
      total: 2,
      processed: 1,
      updated: 1,
      unchanged: 0,
    });
    expect(tree.writes.map(({ id }) => id)).toEqual(['child']);
    expect(tree.get('child').attributes.slug).toBe('concurrent/parent');
    expect(tree.get('grandchild').attributes.slug).toBe('old/grandchild');
  });

  it('stops after six transient write attempts and reports unconfirmed work accurately', async () => {
    const tree = simpleTree();
    tree.beforeUpdate = () => {
      throw httpError(503);
    };
    const error = await failure(run(tree));
    expect(tree.attempts).toHaveLength(6);
    expect(tree.writes).toHaveLength(0);
    expect(error.progress).toMatchObject({
      total: 1,
      processed: 0,
      updated: 0,
    });
    expect(error.message).toMatch(/could not be confirmed/i);
  });

  it('waits for all in-flight writes after a batch failure and counts only successful writes', async () => {
    const tree = simpleTree(8);
    const gate = deferred();
    const started = deferred();
    let startedWrites = 0;
    tree.beforeUpdate = async ({ id }) => {
      startedWrites++;
      if (startedWrites === 4) started.release();
      if (id === 'child-0') throw httpError(422);
      await gate.promise;
    };
    let returned = false;
    const pending = failure(run(tree)).then((error) => {
      returned = true;
      return error;
    });
    await started.promise;
    expect(returned).toBe(false);
    expect(tree.active).toBeGreaterThan(0);
    gate.release();
    const error = await pending;
    expect(error.message).toMatch(/API rejected.*child-0/i);
    expect(error.message).not.toContain('private request data');
    expect(error.progress).toMatchObject({
      total: 8,
      processed: 3,
      updated: 3,
      unchanged: 0,
    });
    expect(tree.attempts).toHaveLength(4);
    expect(tree.writes).toHaveLength(3);
    expect(tree.active).toBe(0);
  });

  it('detects a root edit after descendants finish and preserves completion counts', async () => {
    const tree = simpleTree();
    tree.beforeFind = (id) => {
      if (id === ROOT && tree.writes.length === 1)
        tree.change(ROOT, { slug: 'concurrent/root' });
    };
    const error = await failure(run(tree));
    expect(error.message).toMatch(/Record root changed/i);
    expect(error.progress).toMatchObject({
      phase: 'updating',
      processed: 1,
      updated: 1,
      total: 1,
    });
    expect(tree.get(ROOT).attributes.slug).toBe('concurrent/root');
  });

  it('ignores exceptions thrown by progress observers', async () => {
    const tree = simpleTree();
    const result = await updateAllChildrenSlugs(
      tree.client,
      MODEL,
      tree.get(ROOT),
      { slug: 'new' },
      {
        ...NO_WAIT,
        onProgress: () => {
          throw new Error('The observer disappeared.');
        },
      },
    );
    expect(result.phase).toBe('complete');
    expect(tree.writes).toHaveLength(1);
  });
});

describe('safe cancellation', () => {
  it('performs no calls if already cancelled', async () => {
    const tree = simpleTree();
    const controller = new AbortController();
    controller.abort();
    const error = await failure(
      updateAllChildrenSlugs(
        tree.client,
        MODEL,
        tree.get(ROOT),
        { slug: 'new' },
        {
          ...NO_WAIT,
          signal: controller.signal,
        },
      ),
    );
    expect(error.message).toMatch(/cancelled/i);
    expect(tree.queries).toHaveLength(0);
    expect(tree.finds).toHaveLength(0);
    expect(tree.attempts).toHaveLength(0);
  });

  it('cancels delayed descendant reads without allowing writes after they settle', async () => {
    const tree = simpleTree(8);
    const controller = new AbortController();
    const gate = deferred();
    const started = deferred();
    tree.beforeFind = async (id) => {
      if (id === ROOT) return;
      if (tree.finds.length === 4) started.release();
      await gate.promise;
    };
    const pending = failure(
      updateAllChildrenSlugs(
        tree.client,
        MODEL,
        tree.get(ROOT),
        { slug: 'new' },
        { ...NO_WAIT, signal: controller.signal },
      ),
    );
    await started.promise;
    controller.abort();
    const error = await pending;
    expect(error.message).toMatch(/cancelled/i);
    expect(error.progress).toMatchObject({
      processed: 0,
      updated: 0,
      total: 8,
    });
    expect(tree.attempts).toHaveLength(0);
    gate.release();
    // The fake transport cannot abort its read; eventual responses still must not write.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(tree.attempts).toHaveLength(0);
    expect(tree.writes).toHaveLength(0);
  });

  it('drains writes already in flight and starts no writes after cancellation returns', async () => {
    const tree = simpleTree(8);
    const controller = new AbortController();
    const gate = deferred();
    const started = deferred();
    tree.beforeUpdate = async () => {
      if (tree.attempts.length === 4) started.release();
      await gate.promise;
    };
    let returned = false;
    const pending = failure(
      updateAllChildrenSlugs(
        tree.client,
        MODEL,
        tree.get(ROOT),
        { slug: 'new' },
        {
          ...NO_WAIT,
          signal: controller.signal,
        },
      ),
    ).then((error) => {
      returned = true;
      return error;
    });
    await started.promise;
    controller.abort();
    await Promise.resolve();
    expect(returned).toBe(false);
    gate.release();
    const error = await pending;
    expect(error.message).toMatch(/cancelled/i);
    expect(error.progress).toMatchObject({
      total: 8,
      processed: 4,
      updated: 4,
    });
    expect(tree.active).toBe(0);
    const writeCount = tree.writes.length;
    await Promise.resolve();
    await Promise.resolve();
    expect(tree.writes).toHaveLength(writeCount);
    expect(tree.attempts).toHaveLength(4);
  });
});
