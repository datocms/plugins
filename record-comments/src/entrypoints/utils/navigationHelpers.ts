type ContextWithSiteAndEnv = {
  site: {
    attributes: {
      internal_domain: string | null;
    };
  };
  environment: string;
  isEnvironmentPrimary: boolean;
};

function getBaseUrl(ctx: ContextWithSiteAndEnv): string | null {
  const domain = ctx.site.attributes.internal_domain;
  return domain ? `https://${domain}` : null;
}

function getEnvironmentPrefix(ctx: ContextWithSiteAndEnv): string {
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
