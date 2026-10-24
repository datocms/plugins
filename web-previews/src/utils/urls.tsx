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
