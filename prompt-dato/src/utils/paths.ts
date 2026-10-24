type RecordEditPathContext = {
  environment: string;
  isEnvironmentPrimary: boolean;
};

type PluginSettingsPathContext = RecordEditPathContext & {
  plugin: { id: string };
};

export function getEnvironmentPrefix(ctx: RecordEditPathContext): string {
  return ctx.isEnvironmentPrimary ? '' : `/environments/${ctx.environment}`;
}

export function buildRecordEditPath(
  ctx: RecordEditPathContext,
  modelId: string,
  recordId: string,
): string {
  return `${getEnvironmentPrefix(
    ctx,
  )}/editor/item_types/${modelId}/items/${recordId}/edit`;
}

/** The CMS path of the settings of this plugin, in the current environment */
export function pluginSettingsPath(ctx: PluginSettingsPathContext): string {
  return `${getEnvironmentPrefix(ctx)}/configuration/plugins/${ctx.plugin.id}/edit`;
}
