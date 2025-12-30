import { useCallback } from 'react';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import { buildRecordEditPath } from '@utils/navigationHelpers';
import { useNavigationCallbacksBase } from './useNavigationCallbacksBase';

type UseNavigationCallbacksReturn = {
  handleScrollToField: (fieldPath: string, localized: boolean, locale?: string) => Promise<void>;
  handleNavigateToUsers: () => void;
  handleNavigateToModel: (modelId: string, isBlockModel: boolean) => void;
  handleOpenAsset: (assetId: string) => Promise<void>;
  handleOpenRecord: (recordId: string, modelId: string) => Promise<void>;
};


export function useNavigationCallbacks(ctx: RenderItemFormSidebarCtx): UseNavigationCallbacksReturn {
  const base = useNavigationCallbacksBase(ctx);

  const handleScrollToField = useCallback(
    async (fieldPath: string, localized: boolean, locale?: string) => {
      try {
        const modelId = ctx.itemType.id;
        const recordId = ctx.item?.id;

        if (!recordId) return;

        if (localized) {
          const effectiveLocale = locale ?? ctx.locale;
          await ctx.scrollToField(fieldPath, effectiveLocale);

          // Check if locale is already in path (e.g., sections.it.0.hero_title)
          const localeAlreadyInPath = effectiveLocale && fieldPath.includes(`.${effectiveLocale}.`);
          const fullPath = localeAlreadyInPath ? fieldPath : `${fieldPath}.${effectiveLocale}`;
          const path = `${buildRecordEditPath(modelId, recordId)}#fieldPath=${fullPath}`;
          await ctx.navigateTo(path);
        } else {
          const path = `${buildRecordEditPath(modelId, recordId)}#fieldPath=${fieldPath}`;
          await ctx.navigateTo(path);
        }
      } catch {
        // Silent: field navigation is best-effort (may not exist, hidden by permissions, etc.)
      }
    },
    [ctx]
  );

  const handleOpenRecord = useCallback(
    async (recordId: string, _modelId: string) => {
      // Clear fieldPath hash to prevent highlight carry-over to modal
      if (window.location.hash.includes('fieldPath=')) {
        const currentPath = window.location.pathname + window.location.search;
        window.history.replaceState(null, '', currentPath);
      }
      await ctx.editItem(recordId);
    },
    [ctx]
  );

  return {
    ...base,
    handleScrollToField,
    handleOpenRecord,
  };
}
