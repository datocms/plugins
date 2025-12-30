type ContextWithSite = {
  site: {
    attributes: {
      internal_domain: string | null;
    };
  };
};

export function getBaseUrl(ctx: ContextWithSite): string {
  const domain = ctx.site.attributes.internal_domain;
  return domain ? `https://${domain}` : '';
}

export function buildModelPath(modelId: string, isBlockModel: boolean): string {
  return isBlockModel
    ? `/schema/blocks_library/${modelId}`
    : `/schema/item_types/${modelId}`;
}

export function buildRecordEditPath(modelId: string, recordId: string): string {
  return `/editor/item_types/${modelId}/items/${recordId}/edit`;
}

/** 'user' -> /project_settings/users, 'sso' -> /project_settings/sso-users, 'owner' -> not navigable */
export type NavigableUserType = 'user' | 'sso' | 'owner';

export function openUsersPage(ctx: ContextWithSite, userType: NavigableUserType): void {
  const baseUrl = getBaseUrl(ctx);

  if (userType === 'sso') {
    window.open(`${baseUrl}/project_settings/sso-users`, '_blank');
  } else if (userType === 'user') {
    window.open(`${baseUrl}/project_settings/users`, '_blank');
  }
}

export function openModelPage(
  ctx: ContextWithSite,
  modelId: string,
  isBlockModel: boolean
): void {
  const baseUrl = getBaseUrl(ctx);
  const path = buildModelPath(modelId, isBlockModel);
  window.open(`${baseUrl}${path}`, '_blank');
}
