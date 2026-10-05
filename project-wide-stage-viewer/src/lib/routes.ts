type RouteContext = {
  environment: string;
  isEnvironmentPrimary: boolean;
};

/** Dashboard paths need the sandbox prefix; the primary environment has none. */
function environmentPrefix(ctx: RouteContext): string {
  return ctx.isEnvironmentPrimary ? '' : `/environments/${ctx.environment}`;
}

export function recordEditorPath(
  ctx: RouteContext,
  modelId: string,
  recordId: string,
): string {
  return `${environmentPrefix(ctx)}/editor/item_types/${modelId}/items/${recordId}/edit`;
}

export function pluginSettingsPath(
  ctx: RouteContext,
  pluginId: string,
): string {
  return `${environmentPrefix(ctx)}/configuration/plugins/${pluginId}/edit`;
}
