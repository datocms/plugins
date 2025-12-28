import { useCallback } from 'react';
import type { RenderItemFormSidebarCtx, RenderPageCtx } from 'datocms-plugin-sdk';
import { openUsersPage, openModelPage } from '@utils/navigationHelpers';

type NavigationContext = RenderItemFormSidebarCtx | RenderPageCtx;

export type BaseNavigationCallbacks = {
  handleNavigateToUsers: () => void;
  handleNavigateToModel: (modelId: string, isBlockModel: boolean) => void;
  handleOpenAsset: (assetId: string) => Promise<void>;
};

/**
 * Base hook for shared navigation callbacks.
 *
 * Design note: This is deliberately separate from useNavigationCallbacks and
 * usePageNavigationCallbacks because:
 *
 * 1. Different SDK context types (RenderItemFormSidebarCtx vs RenderPageCtx)
 *    require separate hooks - they can't be easily unified with a discriminated union
 *    since the SDK types don't share a common base.
 *
 * 2. Context-specific callbacks exist:
 *    - Sidebar: handleScrollToField (requires ctx.item, ctx.scrollToField)
 *    - Page: handleNavigateToRecordComments (no record context to scroll to)
 *
 * 3. handleOpenRecord has different implementations:
 *    - Sidebar: ctx.editItem(recordId) - can use the richer sidebar API
 *    - Page: ctx.navigateTo(path) - must build full URL path
 *
 * This base hook extracts the truly shared callbacks that work identically
 * in both contexts (openUsersPage, openModelPage, editUpload).
 */
export function useNavigationCallbacksBase(ctx: NavigationContext): BaseNavigationCallbacks {
  const handleNavigateToUsers = useCallback(() => {
    openUsersPage(ctx);
  }, [ctx]);

  const handleNavigateToModel = useCallback(
    (modelId: string, isBlockModel: boolean) => {
      openModelPage(ctx, modelId, isBlockModel);
    },
    [ctx]
  );

  const handleOpenAsset = useCallback(
    async (assetId: string) => {
      await ctx.editUpload(assetId);
    },
    [ctx]
  );

  return {
    handleNavigateToUsers,
    handleNavigateToModel,
    handleOpenAsset,
  };
}
