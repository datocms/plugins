import { useCallback } from 'react';
import type { RenderItemFormSidebarCtx, RenderPageCtx } from 'datocms-plugin-sdk';
import { openUsersPage, openModelPage, type NavigableUserType } from '@utils/navigationHelpers';

type NavigationContext = RenderItemFormSidebarCtx | RenderPageCtx;

export type BaseNavigationCallbacks = {
  handleNavigateToUsers: (userType?: NavigableUserType) => void;
  handleNavigateToModel: (modelId: string, isBlockModel: boolean) => void;
  handleOpenAsset: (assetId: string) => Promise<void>;
};

/** Shared navigation callbacks for sidebar and page contexts. */
export function useNavigationCallbacksBase(ctx: NavigationContext): BaseNavigationCallbacks {
  const handleNavigateToUsers = useCallback((userType: NavigableUserType = 'user') => {
    openUsersPage(ctx, userType);
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
