import type { BaseCtx } from 'datocms-react-ui';

/**
 * Parses an absolute URL without throwing.
 * @returns The parsed URL, or undefined for relative or malformed input.
 */
export function parseUrl(urlString: string): URL | undefined {
  try {
    return new URL(urlString);
  } catch {
    return undefined;
  }
}

/**
 * If the preview URL points to the draft-mode route and contains a `redirect`
 * query param, returns the redirect path. Otherwise returns undefined.
 */
export function extractRedirectFromDraftModePreviewUrl(
  urlString: string,
  draftModeUrl: string,
): string | undefined {
  const url = parseUrl(urlString);
  const draftMode = parseUrl(draftModeUrl);

  if (
    url &&
    draftMode &&
    url.origin === draftMode.origin &&
    url.pathname === draftMode.pathname
  ) {
    return url.searchParams.get('redirect') ?? undefined;
  }

  return undefined;
}

/**
 * The page path a preview link sends the browser to via its `redirect` query
 * param, as the official starters' draft-mode enable/disable routes do.
 */
export function extractRedirectPath(urlString: string): string | undefined {
  const redirect = parseUrl(urlString)?.searchParams.get('redirect');
  return redirect?.startsWith('/') ? redirect : undefined;
}

/**
 * A short label for a preview link URL, without its `token` parameter.
 * Malformed URLs come back unchanged.
 */
export function displayPath(urlString: string): string {
  const redirectPath = extractRedirectPath(urlString);
  if (redirectPath) {
    return redirectPath;
  }

  const url = parseUrl(urlString);
  if (!url) {
    return urlString;
  }

  url.searchParams.delete('token');
  // Display only: undo the encoding URLSearchParams applies on serialization
  return url.pathname + decodeURIComponent(url.search);
}

/** Like `displayPath()`, prefixed with the host the browser ends up on. */
export function displayUrl(urlString: string): string {
  return displayHost(urlString) + displayPath(urlString);
}

/** The URL's host, or an empty string for malformed URLs. */
export function displayHost(urlString: string): string {
  return parseUrl(urlString)?.host ?? '';
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
