/**
 * Shared navigation helper functions for DatoCMS plugin navigation.
 * Used by both sidebar (RenderItemFormSidebarCtx) and page (RenderPageCtx) contexts.
 */

import { PLUGIN_IDS } from '@/constants';

type ContextWithSite = {
  site: {
    attributes: {
      internal_domain: string | null;
    };
  };
};

type ContextWithPlugin = ContextWithSite & {
  plugin: {
    id: string;
  };
};

/**
 * Get the base URL for the current DatoCMS project.
 * Returns empty string if internal_domain is not available.
 */
export function getBaseUrl(ctx: ContextWithSite): string {
  const domain = ctx.site.attributes.internal_domain;
  return domain ? `https://${domain}` : '';
}

/**
 * Build the schema path for a model (item type or block).
 */
export function buildModelPath(modelId: string, isBlockModel: boolean): string {
  return isBlockModel
    ? `/schema/blocks_library/${modelId}`
    : `/schema/item_types/${modelId}`;
}

/**
 * Build the record edit path for a given record.
 */
export function buildRecordEditPath(modelId: string, recordId: string): string {
  return `/editor/item_types/${modelId}/items/${recordId}/edit`;
}

/**
 * Open the user profile settings page in a new tab.
 */
export function openUsersPage(ctx: ContextWithPlugin): void {
  const baseUrl = getBaseUrl(ctx);
  const pluginId = ctx.plugin.id;
  window.open(`${baseUrl}/configuration/p/${pluginId}/pages/${PLUGIN_IDS.SETTINGS_PAGE}`, '_blank');
}

/**
 * Open the model schema page in a new tab.
 */
export function openModelPage(
  ctx: ContextWithSite,
  modelId: string,
  isBlockModel: boolean
): void {
  const baseUrl = getBaseUrl(ctx);
  const path = buildModelPath(modelId, isBlockModel);
  window.open(`${baseUrl}${path}`, '_blank');
}
