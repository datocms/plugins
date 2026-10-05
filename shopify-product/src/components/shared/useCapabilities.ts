import { useEffect, useState } from 'react';
import type {
  EffectiveCapabilities,
  ShopifyClient,
} from '../../lib/shopifyClient';

export type Capabilities = EffectiveCapabilities & {
  /**
   * Still detecting: the optional scopes aren't known yet. The picker holds
   * the place of the filters that need them, and waits to ask for filter
   * values.
   */
  pending: boolean;
};

/**
 * What this store's token can read. Stores saved without capabilities (the
 * settings check failed or timed out) are probed once in the background,
 * unless this tab already did it (`hasKnownCapabilities()`). A failed probe
 * leaves the optional features off; everything else keeps working.
 */
export function useCapabilities(client: ShopifyClient): Capabilities {
  const [settledFor, setSettledFor] = useState<ShopifyClient | null>(null);
  const needsDetection = !client.hasKnownCapabilities();

  useEffect(() => {
    if (!needsDetection) return undefined;
    const controller = new AbortController();
    const settle = () => {
      if (!controller.signal.aborted) setSettledFor(client);
    };
    client
      .detectCapabilities({ signal: controller.signal })
      .then(settle, settle);
    return () => controller.abort();
  }, [client, needsDetection]);

  return {
    ...client.effectiveCapabilities(),
    pending: needsDetection && settledFor !== client,
  };
}
