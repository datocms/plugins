import type { Client } from '@datocms/cma-client-browser';

/** A slug field value: a string, or one string per locale when localized. */
export type SlugValue = string | Record<string, string | null> | null;

type LocalizedSlug = Record<string, string | null>;

function isLocalizedSlug(value: unknown): value is LocalizedSlug {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withPrefix(prefix: unknown, childSlug: unknown): string | null {
  if (typeof prefix !== 'string' || typeof childSlug !== 'string') return null;
  // Keep only the child's own segment (the part after the last "/")
  return `${prefix}/${childSlug.slice(childSlug.lastIndexOf('/') + 1)}`;
}

/**
 * Computes a child's slug under the parent's new slug. A missing slug (or a
 * missing locale) yields null, which stops inheritance on that branch.
 */
export function inheritSlug(
  childSlug: unknown,
  parentSlug: SlugValue,
): SlugValue {
  if (!isLocalizedSlug(parentSlug)) return withPrefix(parentSlug, childSlug);
  if (!isLocalizedSlug(childSlug)) return null;
  return Object.fromEntries(
    Object.entries(parentSlug).map(([locale, prefix]) => [
      locale,
      withPrefix(prefix, childSlug[locale]),
    ]),
  );
}

/** Returns the value to write to the child, or undefined if nothing changes. */
function slugUpdate(current: unknown, next: SlugValue): SlugValue | undefined {
  if (!isLocalizedSlug(next)) {
    return next !== null && next !== current ? next : undefined;
  }
  if (!isLocalizedSlug(current)) return undefined;
  const changes = Object.entries(next).filter(
    ([locale, value]) => value !== null && current[locale] !== value,
  );
  // Send every locale so unaffected locales are preserved
  return changes.length > 0
    ? { ...current, ...Object.fromEntries(changes) }
    : undefined;
}

function isEmpty(slug: SlugValue): boolean {
  return isLocalizedSlug(slug)
    ? Object.values(slug).every((value) => value === null)
    : slug === null;
}

async function updateChildren(
  client: Client,
  modelId: string,
  parentId: string,
  slugFieldKey: string,
  parentSlug: SlugValue,
  visited: Set<string>,
) {
  // Collect every page of direct children before changing any of them
  const children = [];
  for await (const child of client.items.listPagedIterator({
    filter: { type: modelId, fields: { parent: { eq: parentId } } },
    version: 'current',
  })) {
    children.push(child);
  }

  for (const child of children) {
    if (visited.has(child.id)) {
      throw new Error('A cycle was detected in the tree.');
    }
    visited.add(child.id);

    const current = child[slugFieldKey];
    const childSlug = inheritSlug(current, parentSlug);
    const update = slugUpdate(current, childSlug);

    if (update !== undefined) {
      // biome-ignore lint/performance/noAwaitInLoops: children are updated one at a time
      await client.items.update(child.id, {
        [slugFieldKey]: update,
        meta: { current_version: child.meta.current_version },
      });
    }

    if (!isEmpty(childSlug)) {
      await updateChildren(
        client,
        modelId,
        child.id,
        slugFieldKey,
        childSlug,
        visited,
      );
    }
  }
}

/**
 * Updates the slugs of every descendant of a record so that each one is
 * prefixed with its parent's slug.
 */
export default async function updateAllChildrenSlugs(
  client: Client,
  modelId: string,
  parentId: string,
  slugFieldKey: string,
  updatedSlug: SlugValue,
) {
  await updateChildren(
    client,
    modelId,
    parentId,
    slugFieldKey,
    updatedSlug,
    new Set([parentId]),
  );
}
