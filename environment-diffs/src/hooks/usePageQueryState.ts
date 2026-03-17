import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { useCallback, useMemo } from 'react';
import { buildPageUrl } from '../lib/datocms';
import { parsePageQueryState } from '../lib/query';
import type { PageQueryState } from '../types';

export function usePageQueryState(ctx: RenderPageCtx, pageId: string) {
  const query = useMemo(
    () => parsePageQueryState(ctx.location.search),
    [ctx.location.search],
  );

  const updateQuery = useCallback(
    async (patch: Partial<PageQueryState>) => {
      const nextQuery: PageQueryState = {
        ...query,
        ...patch,
      };

      await ctx.navigateTo(
        buildPageUrl(ctx, pageId, {
          leftEnv: nextQuery.leftEnv,
          rightEnv: nextQuery.rightEnv,
          filter: nextQuery.filter,
          entityType: nextQuery.entityType,
          entityId: nextQuery.entityId,
        }),
      );
    },
    [ctx, pageId, query],
  );

  return {
    query,
    updateQuery,
  };
}
