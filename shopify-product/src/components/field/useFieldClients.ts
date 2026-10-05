import { useEffect, useMemo, useState } from 'react';
import { toShopifyLanguageCode } from '../../lib/format';
import {
  getShopifyClient,
  isAbortError,
  type ShopifyClient,
} from '../../lib/shopifyClient';
import type { StoreConnection } from '../../types';

type LanguageMapping = {
  /** `{shop}|{locale}` the mapping was computed for. */
  key: string;
  /** Shopify `LanguageCode`, or null to keep the store's default. */
  language: string | null;
};

export type FieldClients = {
  /** The store's default market: always available. */
  base: ShopifyClient;
  /**
   * No market at all, so Shopify answers in the shop's primary language and
   * currency, as 1.x did when it saved its JSON. Every 1.x JSON read and
   * write goes through it: the record locale or the store's default market
   * would otherwise read as drift, and rewrite the saved title and price.
   */
  legacy: ShopifyClient;
  /**
   * The client to hydrate with: the base client, or for localized fields the
   * same market in the record locale's language. Null while that language is
   * being looked up.
   */
  client: ShopifyClient | null;
};

/**
 * The shared Shopify client for the field's store. Localized fields read
 * titles in the record's locale when the store offers that language
 * (`localization.availableLanguages`); otherwise, or when the lookup fails,
 * they silently keep the store's default market.
 */
export function useFieldClients(
  store: StoreConnection,
  localized: boolean,
  locale: string,
): FieldClients {
  const base = useMemo(() => getShopifyClient(store), [store]);
  const legacy = useMemo(() => base.withContext({}), [base]);
  const mappingKey = `${base.shopDomain}|${locale}`;
  const [mapping, setMapping] = useState<LanguageMapping | null>(null);

  useEffect(() => {
    if (!localized) return;
    const controller = new AbortController();
    base
      .localization({ signal: controller.signal })
      .then((info) => {
        const available = info.availableLanguages.map((lang) => lang.isoCode);
        setMapping({
          key: mappingKey,
          language: toShopifyLanguageCode(locale, available) ?? null,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setMapping({ key: mappingKey, language: null });
      });
    return () => controller.abort();
  }, [base, localized, locale, mappingKey]);

  const client = useMemo(() => {
    if (!localized) return base;
    if (mapping?.key !== mappingKey) return null;
    return mapping.language
      ? base.withContext({ ...base.context, language: mapping.language })
      : base;
  }, [base, localized, mapping, mappingKey]);

  return { base, legacy, client };
}
