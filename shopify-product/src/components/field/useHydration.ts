import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HydrationStatus } from '../../lib/fieldValue';
import { isNonEmptyString } from '../../lib/guards';
import { isAbortError, type ShopifyClient } from '../../lib/shopifyClient';
import type { ShopifyNode, StoredEntry } from '../../types';

export type HydrationClient = Pick<
  ShopifyClient,
  'loadNodes' | 'productByHandle' | 'collectionByHandle'
>;

export type HydrateOptions = {
  /** 1.x JSON: look the product up by handle when its ID resolves to nothing. */
  handleFallback: boolean;
  signal?: AbortSignal;
};

type NodeMap = Map<string, ShopifyNode | null>;

function needsHandleLookup(
  entry: StoredEntry,
  found: NodeMap,
  handleFallback: boolean,
): boolean {
  if (entry.kind === 'variant' || !isNonEmptyString(entry.handle)) {
    return false;
  }
  if (entry.id === null) return true;
  return handleFallback && found.get(entry.key) === null;
}

function loadByHandle(
  client: HydrationClient,
  entry: StoredEntry,
  signal?: AbortSignal,
): Promise<ShopifyNode | null> {
  const handle = entry.handle ?? '';
  return entry.kind === 'collection'
    ? client.collectionByHandle(handle, { signal })
    : client.productByHandle(handle, { signal });
}

/**
 * Live data for every entry, keyed by entry key (`null` = not visible to the
 * storefront). Every ID goes through one batched `nodes(ids:)` call; entries
 * saved as a handle are looked up by handle.
 */
export async function hydrateEntries(
  client: HydrationClient,
  entries: readonly StoredEntry[],
  options: HydrateOptions,
): Promise<NodeMap> {
  const { signal } = options;
  const found: NodeMap = new Map();
  const withId = entries.filter((entry) => entry.id !== null);
  if (withId.length > 0) {
    const nodes = await client.loadNodes(
      withId.map((entry) => entry.id ?? ''),
      { signal },
    );
    for (const [index, entry] of withId.entries()) {
      found.set(entry.key, nodes[index] ?? null);
    }
  }
  const byHandle = entries.filter((entry) =>
    needsHandleLookup(entry, found, options.handleFallback),
  );
  const handleNodes = await Promise.all(
    byHandle.map((entry) => loadByHandle(client, entry, signal)),
  );
  for (const [index, entry] of byHandle.entries()) {
    found.set(entry.key, handleNodes[index] ?? null);
  }
  for (const entry of entries) {
    if (!found.has(entry.key)) found.set(entry.key, null);
  }
  return found;
}

export type HydrationState = {
  status: HydrationStatus;
  /** Every node loaded so far; previous rows stay visible while rehydrating. */
  nodes: ReadonlyMap<string, ShopifyNode | null>;
  error: unknown;
  /**
   * Loading again after an error ("Try again", or new entries): the error
   * and the rows stay as they are until the new answer arrives.
   */
  retrying: boolean;
};

export type Hydration = HydrationState & {
  retry: () => void;
  /** Adds nodes the picker already returned, so new rows render at once. */
  seed: (nodes: ReadonlyMap<string, ShopifyNode | null>) => void;
};

function merge(
  previous: ReadonlyMap<string, ShopifyNode | null>,
  next: ReadonlyMap<string, ShopifyNode | null>,
): NodeMap {
  const merged = new Map(previous);
  for (const [key, node] of next) merged.set(key, node);
  return merged;
}

/**
 * A new request. After an error it keeps the error, so the callout and the
 * saved rows stay put (with a spinner in "Try again") instead of collapsing
 * into the first-load spinner and back.
 */
function startLoading(current: HydrationState): HydrationState {
  if (current.status === 'error') return { ...current, retrying: true };
  return { ...current, status: 'loading', error: null, retrying: false };
}

/**
 * Hydrates `entries` (pass a membership-stable array: reordering must not
 * refetch). Aborts on unmount and whenever the entries or client change.
 * A change of `inventory` (the store's capability, once a background check
 * grants it) loads them again, with the stock fields; the rows stay shown.
 */
export function useHydration(
  client: HydrationClient | null,
  entries: readonly StoredEntry[],
  handleFallback: boolean,
  inventory = false,
): Hydration {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<HydrationState>(() => ({
    status: entries.length > 0 ? 'loading' : 'ready',
    nodes: new Map(),
    error: null,
    retrying: false,
  }));

  // A new request for new entries, for every "Try again", and when the
  // inventory capability changes the fields Shopify is asked for.
  const request = useMemo(
    () => ({ entries, attempt, inventory }),
    [entries, attempt, inventory],
  );

  useEffect(() => {
    const pending = request.entries;
    if (pending.length === 0 || !client) {
      const status = pending.length === 0 ? 'ready' : 'loading';
      setState((current) => ({
        ...current,
        status,
        error: null,
        retrying: false,
      }));
      return;
    }
    const controller = new AbortController();
    setState(startLoading);
    hydrateEntries(client, pending, {
      handleFallback,
      signal: controller.signal,
    })
      .then((found) => {
        if (controller.signal.aborted) return;
        setState((current) => ({
          status: 'ready',
          nodes: merge(current.nodes, found),
          error: null,
          retrying: false,
        }));
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setState((current) => ({
          ...current,
          status: 'error',
          error,
          retrying: false,
        }));
      });
    return () => controller.abort();
  }, [client, handleFallback, request]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const seed = useCallback((nodes: ReadonlyMap<string, ShopifyNode | null>) => {
    if (nodes.size === 0) return;
    setState((current) => ({ ...current, nodes: merge(current.nodes, nodes) }));
  }, []);

  return { ...state, retry, seed };
}

const NO_NODES: ReadonlyMap<string, ShopifyNode | null> = new Map();

/**
 * The entries loaded with no market, for handle drift when the field reads
 * Shopify in a language: Shopify translates handles there, while saved
 * handles are the shop's primary-language ones. Empty while off or loading,
 * and when the lookup fails (hydration reports connection problems).
 */
export function usePrimaryNodes(
  client: HydrationClient | null,
  entries: readonly StoredEntry[],
  enabled: boolean,
): ReadonlyMap<string, ShopifyNode | null> {
  const [nodes, setNodes] = useState(NO_NODES);

  useEffect(() => {
    if (!enabled || !client || entries.length === 0) return;
    const controller = new AbortController();
    hydrateEntries(client, entries, {
      handleFallback: false,
      signal: controller.signal,
    })
      .then((found) => {
        if (!controller.signal.aborted) {
          setNodes((current) => merge(current, found));
        }
      })
      .catch(() => {
        // Drift is a bonus; the hydration reports connection problems.
      });
    return () => controller.abort();
  }, [client, enabled, entries]);

  return enabled ? nodes : NO_NODES;
}
