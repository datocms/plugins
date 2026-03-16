import type { BaseCtx } from 'datocms-react-ui';

/**
 * If the preview URL points to the draft-mode route and contains a `redirect`
 * query param, returns the redirect path. Otherwise returns undefined.
 */
export function extractRedirectFromDraftModePreviewUrl(
  urlString: string,
  draftModeUrl: string,
): string | undefined {
  const url = new URL(urlString);
  const draftMode = new URL(draftModeUrl);

  if (
    url.origin === draftMode.origin &&
    url.pathname === draftMode.pathname
  ) {
    return url.searchParams.get('redirect') ?? undefined;
  }

  return undefined;
}

export function inspectorUrl(
  ctx: BaseCtx,
  params: { path: string; frontend: string },
): string {
  const base = ctx.isEnvironmentPrimary
    ? `/p/${ctx.plugin.id}/inspectors/visual`
    : `/environments/${ctx.environment}/p/${ctx.plugin.id}/inspectors/visual`;

  return `${base}?${new URLSearchParams(params).toString()}`;
}
