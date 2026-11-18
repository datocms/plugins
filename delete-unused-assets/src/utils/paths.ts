/**
 * The ID of the page of the plugin. The host reads a ':' in a page ID as a
 * route parameter, thus the ID has none.
 */
export const UNUSED_ASSETS_PAGE_ID = 'unused-assets';

/** The path of the page of the plugin, in the settings of the environment */
export function unusedAssetsPagePath(ctx: {
  isEnvironmentPrimary: boolean;
  environment: string;
  plugin: { id: string };
}) {
  const environmentPrefix = ctx.isEnvironmentPrimary
    ? ''
    : `/environments/${ctx.environment}`;
  return `${environmentPrefix}/configuration/p/${ctx.plugin.id}/pages/${UNUSED_ASSETS_PAGE_ID}`;
}
