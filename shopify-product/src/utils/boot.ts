import type { OnBootCtx } from 'datocms-plugin-sdk';
import { FIELD_EXTENSION_ID } from '../constants';
import { isRecord } from '../lib/guards';
import {
  isCurrentPluginParameters,
  isPluginConfigured,
  isStoreUsable,
  normalizePluginParameters,
} from '../lib/parameters';
import type { StoreConnection } from '../types';
import { removeLegacyCache } from './legacyCache';

export const NOT_CONFIGURED_NOTICE =
  'The Shopify plugin needs a store connection. Open its settings to add one.';
export const UPGRADED_NOTICE = 'Shopify plugin successfully upgraded!';
/** How long the migration waits for each store's capability probes. */
export const BOOT_DETECTION_TIMEOUT_MS = 4000;

/** Points 1.x fields that used the plugin's default editor at the extension ID. */
async function upgradeFieldAppearances(ctx: OnBootCtx): Promise<boolean> {
  const fields = await ctx.loadFieldsUsingPlugin();
  const outdated = fields.filter(
    (field) =>
      field.attributes.appearance.editor === ctx.plugin.id &&
      field.attributes.appearance.field_extension !== FIELD_EXTENSION_ID,
  );

  await Promise.all(
    outdated.map((field) =>
      ctx.updateFieldAppearance(field.id, [
        { operation: 'updateEditor', newFieldExtensionId: FIELD_EXTENSION_ID },
      ]),
    ),
  );

  return outdated.length > 0;
}

function needsDetection(store: StoreConnection): boolean {
  return !store.capabilities && isStoreUsable(store);
}

/**
 * Stores migrated from 1.x have no saved capabilities, so field settings
 * would ask for a tags scope the token may already have. Probe each one once
 * while migrating. Best effort: a store whose probes fail or time out is
 * saved as it is, and Re-check in the settings fills it in later.
 */
async function withDetectedCapabilities(
  stores: StoreConnection[],
): Promise<StoreConnection[]> {
  if (!stores.some(needsDetection)) return stores;
  // Only migrations load the client; ordinary boots stay small.
  const { getShopifyClient } = await import('../lib/shopifyClient');
  return Promise.all(
    stores.map(async (store) => {
      if (!needsDetection(store)) return store;
      const controller = new AbortController();
      const timeout = window.setTimeout(
        () => controller.abort(),
        BOOT_DETECTION_TIMEOUT_MS,
      );
      try {
        const capabilities = await getShopifyClient(store).detectCapabilities({
          signal: controller.signal,
        });
        return { ...store, capabilities };
      } catch {
        return store;
      } finally {
        window.clearTimeout(timeout);
      }
    }),
  );
}

/** A fresh install: DatoCMS saved no parameters yet. */
function isFreshInstall(rawParameters: unknown): boolean {
  return !isRecord(rawParameters) || Object.keys(rawParameters).length === 0;
}

/**
 * `onBoot`: deletes the 1.x cache, then, for schema editors only, migrates
 * older parameters to v3 once and shows a single notice.
 */
export async function bootPlugin(ctx: OnBootCtx): Promise<void> {
  // The 1.x cache was shared by every project and store, keyed only by handle.
  removeLegacyCache();

  if (!ctx.currentRole.meta.final_permissions.can_edit_schema) {
    return;
  }

  const rawParameters = ctx.plugin.attributes.parameters;
  if (isCurrentPluginParameters(rawParameters)) {
    return;
  }

  const normalized = normalizePluginParameters(rawParameters);
  const [someFieldsUpgraded, stores] = await Promise.all([
    upgradeFieldAppearances(ctx),
    withDetectedCapabilities(normalized.stores),
  ]);
  const parameters = { ...normalized, stores };
  await ctx.updatePluginParameters(parameters);

  if (!isPluginConfigured(parameters)) {
    // A fresh install opens on the settings screen, whose setup guide already
    // says this; only migrated settings that ended up empty need the notice.
    if (!isFreshInstall(rawParameters)) ctx.notice(NOT_CONFIGURED_NOTICE);
  } else if (someFieldsUpgraded) {
    ctx.notice(UPGRADED_NOTICE);
  }
}
