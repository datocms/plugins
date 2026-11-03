export type ProjectAdminUrlContext = {
  internalDomain: string | null | undefined;
  environment: string;
  isEnvironmentPrimary: boolean;
};

export function environmentAdminPrefix(context: {
  environment: string;
  isEnvironmentPrimary: boolean;
}): string {
  return context.isEnvironmentPrimary
    ? ''
    : `/environments/${context.environment}`;
}

export function projectAdminUrl(
  context: ProjectAdminUrlContext,
  path: string,
): string | null {
  const domain = context.internalDomain?.trim();
  if (!domain) {
    return null;
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `https://${domain}${environmentAdminPrefix(context)}${normalizedPath}`;
}

export function recordEditorPath(itemTypeId: string, itemId: string): string {
  return `/editor/item_types/${encodeURIComponent(itemTypeId)}/items/${encodeURIComponent(itemId)}/edit`;
}
