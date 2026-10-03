import {
  isRetryableError,
  isStaleVersionError,
  RETRY_ATTEMPTS,
  readWithRetry,
  throwIfAborted,
  waitForRetry,
} from './cmaRequests';

export type SlugValue = string | Record<string, string | null> | null;
export type SlugChanges = Record<string, SlugValue>;
type TreeNode = {
  id: string;
  parent: string | null;
  version: string;
  invalidSlug?: boolean;
};

export type TreeRecord = {
  id: string;
  attributes: Record<string, unknown>;
  relationships: { item_type: { data: { id: string } } };
  meta: { current_version: string; has_children?: boolean | null };
};

export type TreeListQuery = {
  filter: { type: string };
  page: { limit: number; offset: number };
  order_by: 'id_ASC';
  nested: false;
  version: 'current';
};

export type TreeClient = {
  items: {
    rawList: (query: TreeListQuery) => Promise<{
      data: TreeRecord[];
      meta: { total_count: number };
    }>;
    rawFind: (
      id: string,
      query: { nested: false; version: 'current' },
    ) => Promise<{ data: TreeRecord }>;
    rawUpdate: (
      id: string,
      body: {
        data: {
          id: string;
          type: 'item';
          attributes: Record<string, unknown>;
          meta: { current_version: string };
        };
      },
    ) => Promise<{ data: TreeRecord }>;
  };
};

export type PropagationProgress = {
  phase: 'loading' | 'updating' | 'complete';
  scanned: number;
  modelTotal: number;
  total: number;
  processed: number;
  updated: number;
  unchanged: number;
};

export type PropagationOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: PropagationProgress) => void;
  /** Present only when this save also changes the parent. */
  newParent?: string | null;
  wait?: (milliseconds: number) => Promise<void>;
  random?: () => number;
};

export class PropagationError extends Error {
  readonly progress: PropagationProgress;
  constructor(message: string, progress: PropagationProgress) {
    super(message);
    this.name = 'PropagationError';
    this.progress = { ...progress };
  }
}

const PAGE_SIZE = 100;
const CONCURRENCY = 4;
const CURRENT = { nested: false, version: 'current' } as const;

export function isSlugValue(value: unknown): value is SlugValue {
  return (
    value === null ||
    typeof value === 'string' ||
    (typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.values(value).every(
        (entry) => entry === null || typeof entry === 'string',
      ))
  );
}

export function sameSlug(left: unknown, right: SlugValue): boolean {
  if (typeof right !== 'object' || right === null) return left === right;
  if (!isSlugValue(left) || typeof left !== 'object' || left === null)
    return false;
  return Object.entries(right).every(
    ([locale, value]) => left[locale] === value,
  );
}

function parentOf(record: TreeRecord): string | null {
  const parent = record.attributes.parent_id;
  if (parent === null || parent === undefined) return null;
  if (typeof parent !== 'string')
    throw new Error('Invalid parent in the tree.');
  return parent;
}

function nodeOf(record: TreeRecord, modelId: string): TreeNode {
  if (
    record.relationships.item_type.data.id !== modelId ||
    !record.meta.current_version
  ) {
    throw new Error(
      'The tree contains a record with an invalid model or version.',
    );
  }
  return {
    id: record.id,
    parent: parentOf(record),
    version: record.meta.current_version,
  };
}

function report(progress: PropagationProgress, options: PropagationOptions) {
  // Feedback must never stop a data operation (for example, after navigation).
  try {
    options.onProgress?.({ ...progress });
  } catch {
    /* Best effort feedback. */
  }
}

type TreeIndex = {
  nodes: Map<string, TreeNode>;
  children: Map<string, string[]>;
};

function appendPage(
  tree: TreeIndex,
  records: TreeRecord[],
  modelId: string,
  prefixes: SlugChanges,
) {
  for (const record of records) {
    const node = nodeOf(record, modelId);
    node.invalidSlug = Object.entries(prefixes).some(([field, prefix]) => {
      if (prefix === null) return false;
      const value = record.attributes[field];
      return (
        !isSlugValue(value) ||
        (value !== null && typeof value !== typeof prefix)
      );
    });
    if (tree.nodes.has(node.id))
      throw new Error('A record appeared twice while loading the tree.');
    tree.nodes.set(node.id, node);
    if (node.parent) {
      const siblings = tree.children.get(node.parent);
      if (siblings) siblings.push(node.id);
      else tree.children.set(node.parent, [node.id]);
    }
  }
}

function validatePage(
  records: TreeRecord[],
  count: number,
  expected: number,
  offset: number,
) {
  if (!Number.isInteger(count) || count < 0 || records.length > PAGE_SIZE) {
    throw new Error('The API returned invalid pagination for the tree.');
  }
  if (count !== expected)
    throw new Error('The number of records changed while loading the tree.');
  if (records.length === 0 && offset < expected) {
    throw new Error('The API returned an incomplete page of the tree.');
  }
}

async function loadTree(
  client: TreeClient,
  modelId: string,
  prefixes: SlugChanges,
  progress: PropagationProgress,
  options: PropagationOptions,
): Promise<TreeIndex> {
  // Discard content, assets, blocks and slug paths after each page.
  const tree: TreeIndex = { nodes: new Map(), children: new Map() };
  let offset = 0;
  let total: number | undefined;
  do {
    throwIfAborted(options.signal);
    // biome-ignore lint/performance/noAwaitInLoops: Consume one bounded page before requesting the next.
    const page = await readWithRetry(
      () =>
        client.items.rawList({
          filter: { type: modelId },
          nested: false,
          version: 'current',
          order_by: 'id_ASC',
          page: { limit: PAGE_SIZE, offset },
        }),
      options,
    );
    total ??= page.meta.total_count;
    validatePage(page.data, page.meta.total_count, total, offset);
    appendPage(tree, page.data, modelId, prefixes);
    offset += page.data.length;
    progress.scanned = offset;
    progress.modelTotal = total;
    report(progress, options);
  } while (offset < total);
  if (tree.nodes.size !== total)
    throw new Error('The tree snapshot is incomplete.');
  return tree;
}

function validateParents(
  tree: TreeIndex,
  rootId: string,
  parent: string | null,
) {
  const visited = new Set([rootId]);
  let ancestor = parent;
  while (ancestor) {
    if (visited.has(ancestor))
      throw new Error('A cycle was detected in the tree.');
    visited.add(ancestor);
    const node = tree.nodes.get(ancestor);
    if (!node) throw new Error('A parent record is missing from the tree.');
    ancestor = node.parent;
  }
}

function countDescendants(tree: TreeIndex, rootId: string): number {
  const visited = new Set([rootId]);
  const pending = [rootId];
  while (pending.length > 0) {
    const parent = pending.pop();
    if (!parent) continue;
    for (const child of tree.children.get(parent) ?? []) {
      if (visited.has(child))
        throw new Error('A cycle was detected in the tree.');
      if (tree.nodes.get(child)?.invalidSlug) {
        throw new Error(`Record ${child} has an invalid or incompatible slug.`);
      }
      visited.add(child);
      pending.push(child);
    }
  }
  return visited.size - 1;
}

function ownSegment(slug: string): string {
  return slug.slice(slug.lastIndexOf('/') + 1);
}

function inheritSlug(current: unknown, prefix: SlugValue): SlugValue {
  if (prefix === null) return null;
  if (!isSlugValue(current))
    throw new Error('A descendant has an invalid slug.');
  if (typeof prefix === 'string') {
    if (current === null) return null;
    if (typeof current !== 'string')
      throw new Error('A descendant has an incompatible localized slug.');
    return `${prefix}/${ownSegment(current)}`;
  }
  if (current === null) return null;
  if (typeof current === 'string')
    throw new Error('A descendant has an incompatible non-localized slug.');
  const result: Record<string, string | null> = {};
  for (const [locale, parentSlug] of Object.entries(prefix)) {
    const childSlug = current[locale];
    // Missing locale stops inheritance on this branch; never manufacture a slug.
    result[locale] =
      typeof parentSlug === 'string' && typeof childSlug === 'string'
        ? `${parentSlug}/${ownSegment(childSlug)}`
        : null;
  }
  return result;
}

function prepareChanges(record: TreeRecord, prefixes: SlugChanges) {
  const next: SlugChanges = {};
  const attributes: Record<string, SlugValue> = {};
  for (const [field, prefix] of Object.entries(prefixes)) {
    const current = record.attributes[field];
    const inherited = inheritSlug(current, prefix);
    next[field] = inherited;
    if (inherited === null) continue;
    if (typeof inherited === 'string') {
      if (current !== inherited) attributes[field] = inherited;
    } else if (isSlugValue(current) && typeof current === 'object' && current) {
      const changes = Object.fromEntries(
        Object.entries(inherited).filter(
          ([locale, value]) => value !== null && current[locale] !== value,
        ),
      );
      // Preserve all unaffected locales when sending a complete localized field.
      if (Object.keys(changes).length > 0)
        attributes[field] = { ...current, ...changes };
    }
  }
  return { next, attributes };
}

function assertUnchanged(record: TreeRecord, node: TreeNode, modelId: string) {
  if (
    record.id !== node.id ||
    record.relationships.item_type.data.id !== modelId ||
    parentOf(record) !== node.parent ||
    record.meta.current_version !== node.version
  ) {
    throw new Error(`Record ${node.id} changed during slug propagation.`);
  }
}

function holdsWrite(
  record: TreeRecord,
  node: TreeNode,
  modelId: string,
  attributes: Record<string, SlugValue>,
) {
  return (
    record.id === node.id &&
    record.relationships.item_type.data.id === modelId &&
    parentOf(record) === node.parent &&
    Object.entries(attributes).every(([field, value]) =>
      sameSlug(record.attributes[field], value),
    )
  );
}

function confirmedVersion(
  record: TreeRecord,
  node: TreeNode,
  modelId: string,
  attributes: Record<string, SlugValue>,
) {
  if (
    !holdsWrite(record, node, modelId, attributes) ||
    !record.meta.current_version
  ) {
    throw new Error(
      `The API returned an invalid slug update for record ${node.id}.`,
    );
  }
  return record.meta.current_version;
}

async function writeSafely(
  client: TreeClient,
  node: TreeNode,
  modelId: string,
  attributes: Record<string, SlugValue>,
  options: PropagationOptions,
) {
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    throwIfAborted(options.signal);
    try {
      // biome-ignore lint/performance/noAwaitInLoops: Retry one guarded write only after reconciliation.
      const { data: written } = await client.items.rawUpdate(node.id, {
        data: {
          id: node.id,
          type: 'item',
          attributes,
          meta: { current_version: node.version },
        },
      });
      return confirmedVersion(written, node, modelId, attributes);
    } catch (error) {
      if (!isRetryableError(error) && !isStaleVersionError(error)) {
        throw new Error(
          `The API rejected the slug update for record ${node.id}.`,
        );
      }
      // A lost response can conceal a successful PUT. Check before resubmitting
      // the same version-guarded write; never overwrite somebody else's version.
      const { data: current } = await readWithRetry(
        () => client.items.rawFind(node.id, CURRENT),
        options,
      );
      if (holdsWrite(current, node, modelId, attributes))
        return confirmedVersion(current, node, modelId, attributes);
      assertUnchanged(current, node, modelId);
      if (attempt + 1 === RETRY_ATTEMPTS || isStaleVersionError(error)) {
        throw new Error(
          `The slug update could not be confirmed for record ${node.id}.`,
        );
      }
      await waitForRetry(error, attempt, options);
    }
  }
  throw new Error(
    `The slug update could not be confirmed for record ${node.id}.`,
  );
}

async function updateNode(
  client: TreeClient,
  node: TreeNode,
  modelId: string,
  prefixes: SlugChanges,
  progress: PropagationProgress,
  options: PropagationOptions,
) {
  throwIfAborted(options.signal);
  const { data: record } = await readWithRetry(
    () => client.items.rawFind(node.id, CURRENT),
    options,
  );
  assertUnchanged(record, node, modelId);
  const { next, attributes } = prepareChanges(record, prefixes);
  if (Object.keys(attributes).length > 0) {
    node.version = await writeSafely(
      client,
      node,
      modelId,
      attributes,
      options,
    );
    progress.updated++;
  } else {
    progress.unchanged++;
  }
  progress.processed++;
  report(progress, options);
  return next;
}

type ParentGroup = { id: string; prefixes: SlugChanges };

async function drainBatch(batch: Promise<void>[]) {
  const settled = await Promise.allSettled(batch);
  batch.length = 0;
  const failure = settled.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
}

async function updateBranchNode(
  client: TreeClient,
  tree: TreeIndex,
  modelId: string,
  id: string,
  prefixes: SlugChanges,
  progress: PropagationProgress,
  options: PropagationOptions,
  nextFrontier: ParentGroup[],
) {
  const node = tree.nodes.get(id);
  if (!node) throw new Error(`Record ${id} is missing from the tree.`);
  const next = await updateNode(
    client,
    node,
    modelId,
    prefixes,
    progress,
    options,
  );
  if (tree.children.has(id)) nextFrontier.push({ id, prefixes: next });
}

async function revalidateParent(
  client: TreeClient,
  tree: TreeIndex,
  modelId: string,
  id: string,
  options: PropagationOptions,
) {
  const node = tree.nodes.get(id);
  if (!node) throw new Error(`Record ${id} is missing from the tree.`);
  const { data: current } = await readWithRetry(
    () => client.items.rawFind(id, CURRENT),
    options,
  );
  assertUnchanged(current, node, modelId);
}

async function updateDescendants(
  client: TreeClient,
  tree: TreeIndex,
  modelId: string,
  rootId: string,
  prefixes: SlugChanges,
  progress: PropagationProgress,
  options: PropagationOptions,
) {
  let frontier: ParentGroup[] = [{ id: rootId, prefixes }];
  while (frontier.length > 0) {
    const nextFrontier: ParentGroup[] = [];
    const batch: Promise<void>[] = [];
    try {
      for (const parent of frontier) {
        // A child's unchanged version cannot detect edits to its parent after
        // that parent's write. Revalidate before using an intermediate prefix.
        // biome-ignore lint/performance/noAwaitInLoops: Validate each parent before scheduling its descendants.
        await revalidateParent(client, tree, modelId, parent.id, options);
        for (const id of tree.children.get(parent.id) ?? []) {
          throwIfAborted(options.signal);
          batch.push(
            updateBranchNode(
              client,
              tree,
              modelId,
              id,
              parent.prefixes,
              progress,
              options,
              nextFrontier,
            ),
          );
          if (batch.length === CONCURRENCY) {
            // biome-ignore lint/performance/noAwaitInLoops: Bound in-flight requests and settle failures before scheduling more.
            await drainBatch(batch);
          }
        }
      }
      await drainBatch(batch);
    } catch (error) {
      // Cancellation or a scheduling failure can happen with a short batch in
      // flight. Let every started write settle before reporting the outcome.
      await Promise.allSettled(batch);
      throw error;
    }
    // Release previous levels: deep chains retain only active paths.
    frontier = nextFrontier;
  }
}

/** Continuous, bounded propagation, without recursive calls or a resume flow. */
export default async function updateAllChildrenSlugs(
  client: TreeClient,
  modelId: string,
  root: TreeRecord,
  prefixes: SlugChanges,
  options: PropagationOptions = {},
): Promise<PropagationProgress> {
  const progress: PropagationProgress = {
    phase: 'loading',
    scanned: 0,
    modelTotal: 0,
    total: 0,
    processed: 0,
    updated: 0,
    unchanged: 0,
  };
  try {
    const rootNode = nodeOf(root, modelId);
    // The server's leaf flag avoids scanning a huge model for a simple leaf edit.
    if (root.meta.has_children !== false || options.newParent !== undefined) {
      const tree = await loadTree(client, modelId, prefixes, progress, options);
      const loadedRoot = tree.nodes.get(root.id);
      if (!loadedRoot || loadedRoot.version !== rootNode.version) {
        throw new Error('The parent record changed while loading the tree.');
      }
      validateParents(tree, root.id, loadedRoot.parent);
      if (options.newParent !== undefined)
        validateParents(tree, root.id, options.newParent);
      progress.total =
        Object.keys(prefixes).length > 0 ? countDescendants(tree, root.id) : 0;
      progress.phase = 'updating';
      report(progress, options);
      if (progress.total > 0) {
        await updateDescendants(
          client,
          tree,
          modelId,
          root.id,
          prefixes,
          progress,
          options,
        );
      }
    }
    const { data: currentRoot } = await readWithRetry(
      () => client.items.rawFind(root.id, CURRENT),
      options,
    );
    assertUnchanged(currentRoot, rootNode, modelId);
    progress.phase = 'complete';
    report(progress, options);
    return progress;
  } catch (error) {
    // ApiError includes request headers/body: never show it in the dashboard.
    const message =
      error instanceof Error && !('request' in error) && !('response' in error)
        ? error.message
        : 'The API could not complete slug propagation.';
    throw new PropagationError(message, progress);
  }
}
