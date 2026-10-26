import type { BaseCtx } from 'datocms-react-ui/Canvas';

/** The guide that explains how to set up a frontend for Web Previews */
export const SETUP_GUIDE_URL =
  'https://github.com/datocms/plugins/tree/master/web-previews#installation-and-configuration';

/**
 * If the preview URL points to the draft-mode route and contains a `redirect`
 * query param, returns the redirect path. Otherwise returns undefined, also
 * for a URL that isn't absolute (an endpoint can return one).
 */
export function extractRedirectFromDraftModePreviewUrl(
  urlString: string,
  draftModeUrl: string,
): string | undefined {
  let url: URL;
  let draftMode: URL;

  try {
    url = new URL(urlString);
    draftMode = new URL(draftModeUrl);
  } catch {
    return undefined;
  }

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
  // An endpoint can return a URL that isn't absolute: it shows as it is
  try {
    const redirectPath = extractRedirectPath(urlString);
    if (redirectPath) {
      return redirectPath;
    }

    const url = new URL(urlString);
    url.searchParams.delete('token');
    // Display only: undo the encoding URLSearchParams applies on serialization
    return url.pathname + decodeURIComponent(url.search);
  } catch {
    return urlString;
  }
}

/** The host of a preview link URL, empty for a URL that isn't absolute */
export function hostOf(urlString: string): string {
  try {
    return new URL(urlString).host;
  } catch {
    return '';
  }
}

/** Like `displayPath()`, prefixed with the host the browser ends up on. */
export function displayUrl(urlString: string): string {
  return hostOf(urlString) + displayPath(urlString);
}

/**
 * The start of the CMS paths of the current environment: empty on the
 * primary environment, `/environments/<id>` on a sandbox.
 */
export function environmentPrefix(ctx: BaseCtx): string {
  return ctx.isEnvironmentPrimary ? '' : `/environments/${ctx.environment}`;
}

export function inspectorUrl(
  ctx: BaseCtx,
  params: { path: string; frontend: string },
): string {
  const base = `${environmentPrefix(ctx)}/p/${ctx.plugin.id}/inspectors/visual`;

  return `${base}?${new URLSearchParams(params).toString()}`;
}

/** The settings screen of the plugin, in the current environment */
export function pluginSettingsUrl(ctx: BaseCtx): string {
  return `${environmentPrefix(ctx)}/configuration/plugins/${ctx.plugin.id}/edit`;
}
