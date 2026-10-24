import { buildRecordEditPath } from '@utils/navigationHelpers';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import { useCallback } from 'react';
import { useNavigationCallbacksBase } from './useNavigationCallbacksBase';

type UseNavigationCallbacksReturn = {
  /**
   * The CMS path that opens a field of this record (the record edit path
   * with its #fieldPath), for a link; undefined for an unsaved record, and
   * when the project has no internal domain for the URL of the link
   */
  getFieldLinkPath: (fieldPath: string) => string | undefined;
  handleScrollToField: (
    fieldPath: string,
    localized: boolean,
    locale?: string,
  ) => Promise<void>;
  handleNavigateToUsers: () => void;
  handleNavigateToModel: (modelId: string, isBlockModel: boolean) => void;
  handleOpenAsset: (assetId: string) => Promise<void>;
  handleOpenRecord: (recordId: string, modelId: string) => Promise<void>;
};

export function useNavigationCallbacks(
  ctx: RenderItemFormSidebarCtx,
): UseNavigationCallbacksReturn {
  const base = useNavigationCallbacksBase(ctx);

  const getFieldLinkPath = useCallback(
    (fieldPath: string) => {
      const recordId = ctx.item?.id;
      if (!recordId) return undefined;
      // Without the internal domain the link has no URL of the CMS (a middle
      // click would open the path on the origin of the plugin): the mention
      // then stays an action, through handleScrollToField
      if (!ctx.site.attributes.internal_domain) return undefined;
      return `${buildRecordEditPath(ctx, ctx.itemType.id, recordId)}#fieldPath=${fieldPath}`;
    },
    [ctx],
  );

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
          const localeAlreadyInPath =
            effectiveLocale && fieldPath.includes(`.${effectiveLocale}.`);
          const fullPath = localeAlreadyInPath
            ? fieldPath
            : `${fieldPath}.${effectiveLocale}`;
          const path = `${buildRecordEditPath(ctx, modelId, recordId)}#fieldPath=${fullPath}`;
          await ctx.navigateTo(path);
        } else {
          const path = `${buildRecordEditPath(ctx, modelId, recordId)}#fieldPath=${fieldPath}`;
          await ctx.navigateTo(path);
        }
      } catch {
        // Silent: field navigation is best-effort (may not exist, hidden by permissions, etc.)
      }
    },
    [ctx],
  );

  const handleOpenRecord = useCallback(
    async (recordId: string, _modelId: string) => {
      // Clear fieldPath hash by navigating to clean path before opening modal
      // This prevents field highlight from carrying over to the record edit modal
      const currentRecordId = ctx.item?.id;
      if (currentRecordId) {
        const cleanPath = buildRecordEditPath(
          ctx,
          ctx.itemType.id,
          currentRecordId,
        );
        await ctx.navigateTo(cleanPath);
      }
      await ctx.editItem(recordId);
    },
    [ctx],
  );

  return {
    ...base,
    getFieldLinkPath,
    handleScrollToField,
    handleOpenRecord,
  };
}
