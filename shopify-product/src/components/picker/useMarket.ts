import { useMemo, useState } from 'react';
import { getShopifyClient, type ShopifyClient } from '../../lib/shopifyClient';
import type { ShopifyContext, StoreConnection } from '../../types';

export type Market = {
  /** The store's client in its default market (shared capability state). */
  baseClient: ShopifyClient;
  /** The client for the market the editor is browsing. */
  client: ShopifyClient;
  /** Undefined until the editor or the field picks a market: the store default. */
  context: ShopifyContext | undefined;
  contextKey: string;
  setContext: (context: ShopifyContext) => void;
};

/** The market (`@inContext`) prices and titles are shown in. */
export function useMarket(
  store: StoreConnection,
  initial: ShopifyContext | undefined,
): Market {
  const [context, setContext] = useState<ShopifyContext | undefined>(initial);
  const baseClient = useMemo(() => getShopifyClient(store), [store]);
  const client = useMemo(
    () => baseClient.withContext(context),
    [baseClient, context],
  );
  const contextKey = `${client.context.country ?? '-'}:${client.context.language ?? '-'}`;
  return { baseClient, client, context, contextKey, setContext };
}
