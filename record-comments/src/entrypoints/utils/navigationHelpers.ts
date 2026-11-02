type ContextWithEnv = {
  environment: string;
  isEnvironmentPrimary: boolean;
};

type ContextWithSiteAndEnv = ContextWithEnv & {
  site: {
    attributes: {
      internal_domain: string | null;
    };
  };
};

type ContextWithPluginAndEnv = ContextWithEnv & {
  plugin: { id: string };
};

function getBaseUrl(ctx: ContextWithSiteAndEnv): string | null {
  const domain = ctx.site.attributes.internal_domain;
  return domain ? `https://${domain}` : null;
}

function getEnvironmentPrefix(ctx: ContextWithEnv): string {
  return ctx.isEnvironmentPrimary ? '' : `/environments/${ctx.environment}`;
}

function buildModelPath(modelId: string, isBlockModel: boolean) {
  return isBlockModel
    ? `/schema/blocks_library/${modelId}`
    : `/schema/item_types/${modelId}`;
}

export function buildRecordEditPath(
  ctx: ContextWithSiteAndEnv,
  modelId: string,
  recordId: string,
): string {
  return `${getEnvironmentPrefix(ctx)}/editor/item_types/${modelId}/items/${recordId}/edit`;
}

/** The CMS path of the schema of a model, for a `to` link. */
export function buildModelSchemaPath(
  ctx: ContextWithEnv,
  modelId: string,
  isBlockModel: boolean,
): string {
  return `${getEnvironmentPrefix(ctx)}${buildModelPath(modelId, isBlockModel)}`;
}

/** The CMS path of this plugin's settings, for a `to` link. */
export function buildPluginSettingsPath(ctx: ContextWithPluginAndEnv): string {
  return `${getEnvironmentPrefix(ctx)}/configuration/plugins/${ctx.plugin.id}/edit`;
}

/** 'user' -> /project_settings/users, 'sso' -> /project_settings/sso-users, 'owner' -> not navigable */
export type NavigableUserType = 'user' | 'sso' | 'owner';

export function openUsersPage(
  ctx: ContextWithSiteAndEnv,
  userType: NavigableUserType,
): void {
  const baseUrl = getBaseUrl(ctx);
  if (!baseUrl) return;

  const envPrefix = getEnvironmentPrefix(ctx);

  if (userType === 'sso') {
    window.open(`${baseUrl}${envPrefix}/project_settings/sso-users`, '_blank');
  } else if (userType === 'user') {
    window.open(`${baseUrl}${envPrefix}/project_settings/users`, '_blank');
  }
}

export function openModelPage(
  ctx: ContextWithSiteAndEnv,
  modelId: string,
  isBlockModel: boolean,
): void {
  const baseUrl = getBaseUrl(ctx);
  if (!baseUrl) return;
  const envPrefix = getEnvironmentPrefix(ctx);
  const path = buildModelPath(modelId, isBlockModel);
  window.open(`${baseUrl}${envPrefix}${path}`, '_blank');
}
