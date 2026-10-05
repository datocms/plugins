import { useEffect, useMemo, useState } from 'react';
import {
  buildLegacyProductJson,
  type LegacyDrift,
  legacyJsonDrift,
} from '../../lib/legacy';
import type { ShopifyClient } from '../../lib/shopifyClient';
import type { LegacyProductJson, StoredEntry } from '../../types';

type FreshLegacy = {
  entry: StoredEntry;
  json: LegacyProductJson | null;
};

/**
 * For a 1.x JSON value: what changed in Shopify since it was saved (title,
 * price, image, handle), or null when nothing did, the product can't be
 * found, or the check is off. Image size suffixes saved by older versions
 * (`_200x200`, `_crop_center`) don't count as changes. Pass the context-free
 * client: 1.x saved its JSON in the shop's primary language and currency.
 */
export function useLegacyDrift(
  client: Pick<ShopifyClient, 'legacyProduct'> | null,
  entry: StoredEntry | null,
  stored: Partial<LegacyProductJson> | null,
  enabled: boolean,
): LegacyDrift | null {
  const [fresh, setFresh] = useState<FreshLegacy | null>(null);

  useEffect(() => {
    if (!enabled || !client || !entry) return;
    const controller = new AbortController();
    client
      .legacyProduct(
        { id: entry.id, handle: entry.handle },
        { signal: controller.signal },
      )
      .then((node) => {
        if (controller.signal.aborted) return;
        setFresh({ entry, json: node ? buildLegacyProductJson(node) : null });
      })
      .catch(() => {
        // Hydration reports connection problems; drift is a bonus.
      });
    return () => controller.abort();
  }, [client, enabled, entry]);

  return useMemo(() => {
    if (!enabled || !stored || !fresh?.json || fresh.entry !== entry) {
      return null;
    }
    const drift = legacyJsonDrift(stored, fresh.json);
    return drift.changed ? drift : null;
  }, [enabled, entry, fresh, stored]);
}
