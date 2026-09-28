import type { RenderPageCtx } from 'datocms-plugin-sdk';

export function contextKey(
  ctx: Pick<
    RenderPageCtx,
    'site' | 'environment' | 'currentUser' | 'currentRole'
  >,
) {
  return JSON.stringify([
    ctx.site.id,
    ctx.environment,
    ctx.currentUser.id,
    ctx.currentRole,
  ]);
}
