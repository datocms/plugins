import { useCallback } from 'react';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { buildRecordEditPath } from '@utils/navigationHelpers';
import { useNavigationCallbacksBase } from './useNavigationCallbacksBase';

type UsePageNavigationCallbacksReturn = {
  handleNavigateToUsers: () => void;
  handleNavigateToModel: (modelId: string, isBlockModel: boolean) => void;
  handleOpenAsset: (assetId: string) => Promise<void>;
  handleOpenRecord: (recordId: string, modelId: string) => Promise<void>;
  handleNavigateToRecordComments: (modelId: string, recordId: string) => Promise<void>;
};

export function usePageNavigationCallbacks(ctx: RenderPageCtx): UsePageNavigationCallbacksReturn {
  const base = useNavigationCallbacksBase(ctx);

  const handleOpenRecord = useCallback(
    async (recordId: string, _modelId: string) => {
      await ctx.editItem(recordId);
    },
    [ctx]
  );

  const handleNavigateToRecordComments = useCallback(
    async (modelId: string, recordId: string) => {
      const path = buildRecordEditPath(modelId, recordId);
      await ctx.navigateTo(path);
    },
    [ctx]
  );

  return {
    ...base,
    handleOpenRecord,
    handleNavigateToRecordComments,
  };
}
