import {
  type NavigableUserType,
  openModelPage,
  openUsersPage,
} from '@utils/navigationHelpers';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import { useCallback } from 'react';

export type BaseNavigationCallbacks = {
  handleNavigateToUsers: (userType?: NavigableUserType) => void;
  handleNavigateToModel: (modelId: string, isBlockModel: boolean) => void;
  handleOpenAsset: (assetId: string) => Promise<void>;
};

export function useNavigationCallbacksBase(
  ctx: RenderItemFormSidebarCtx,
): BaseNavigationCallbacks {
  const handleNavigateToUsers = useCallback(
    (userType: NavigableUserType = 'user') => {
      openUsersPage(ctx, userType);
    },
    [ctx],
  );

  const handleNavigateToModel = useCallback(
    (modelId: string, isBlockModel: boolean) => {
      openModelPage(ctx, modelId, isBlockModel);
    },
    [ctx],
  );

  const handleOpenAsset = useCallback(
    async (assetId: string) => {
      await ctx.editUpload(assetId);
    },
    [ctx],
  );

  return {
    handleNavigateToUsers,
    handleNavigateToModel,
    handleOpenAsset,
  };
}
