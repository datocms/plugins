import type { BaseCtx } from 'datocms-react-ui';

export function inspectorUrl(
  ctx: BaseCtx,
  params: { path: string; frontend: string },
): string {
  const base = ctx.isEnvironmentPrimary
    ? `/p/${ctx.plugin.id}/inspectors/visual`
    : `/environments/${ctx.environment}/p/${ctx.plugin.id}/inspectors/visual`;

  return `${base}?${new URLSearchParams(params).toString()}`;
}
