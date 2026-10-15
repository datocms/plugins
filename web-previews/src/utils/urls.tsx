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

  if (url.origin === draftMode.origin && url.pathname === draftMode.pathname) {
    return url.searchParams.get('redirect') ?? undefined;
  }

  return undefined;
}

/**
 * The page path a preview link sends the browser to via its `redirect` query
 * param, as the official starters' draft-mode enable/disable routes do.
 */
export function extractRedirectPath(urlString: string): string | undefined {
  const redirect = new URL(urlString).searchParams.get('redirect');
  return redirect?.startsWith('/') ? redirect : undefined;
}

/** A short, secret-free label for a preview link URL. */
export function displayPath(urlString: string): string {
  const redirectPath = extractRedirectPath(urlString);
  if (redirectPath) {
    return redirectPath;
  }

  const url = new URL(urlString);
  url.searchParams.delete('token');
  // Display only: undo the encoding URLSearchParams applies on serialization
  return url.pathname + decodeURIComponent(url.search);
}

/** Like `displayPath()`, prefixed with the host the browser ends up on. */
export function displayUrl(urlString: string): string {
  return new URL(urlString).host + displayPath(urlString);
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
