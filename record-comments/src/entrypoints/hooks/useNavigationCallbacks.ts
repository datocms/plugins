import { useCallback, useRef, useEffect } from 'react';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import { buildRecordEditPath } from '@utils/navigationHelpers';
import { useNavigationCallbacksBase } from './useNavigationCallbacksBase';

/**
 * Duration in milliseconds before auto-clearing the fieldPath hash from the URL.
 *
 * WHY WE AUTO-CLEAR THE HASH:
 * When a user clicks a field mention, we add #fieldPath=... to the URL to scroll
 * to and highlight that field. However, if this hash persists in the URL:
 * - Page reload would re-navigate to that field, which is confusing
 * - Browser back/forward would re-trigger field navigation
 * - The user's intent was a one-time "show me this field" action, not a permanent state
 *
 * 3 seconds gives enough time for:
 * - The field navigation animation to complete
 * - The user to see where the field is located
 * - The highlight/focus effect to be noticed
 */
const FIELD_PATH_HASH_CLEAR_DELAY_MS = 3000;

type UseNavigationCallbacksReturn = {
  handleScrollToField: (fieldPath: string, localized: boolean, locale?: string) => Promise<void>;
  handleNavigateToUsers: () => void;
  handleNavigateToModel: (modelId: string, isBlockModel: boolean) => void;
  handleOpenAsset: (assetId: string) => Promise<void>;
  handleOpenRecord: (recordId: string, modelId: string) => Promise<void>;
};


/**
 * Hook for navigation-related callbacks used in comment mentions (sidebar context).
 *
 * See useNavigationCallbacksBase for rationale on why this is a separate hook
 * rather than a parameterized version of usePageNavigationCallbacks.
 *
 * Sidebar-specific additions:
 * - handleScrollToField: Uses ctx.scrollToField and ctx.item for field navigation
 * - handleOpenRecord: Uses ctx.editItem() which is available in sidebar context
 */
export function useNavigationCallbacks(ctx: RenderItemFormSidebarCtx): UseNavigationCallbacksReturn {
  const base = useNavigationCallbacksBase(ctx);

  // Track the timeout for clearing fieldPath hash so we can cancel on unmount
  // or when a new field navigation occurs before the previous timeout fires
  const fieldPathClearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timeout on unmount to prevent memory leaks and stale closures
  useEffect(() => {
    return () => {
      if (fieldPathClearTimeoutRef.current) {
        clearTimeout(fieldPathClearTimeoutRef.current);
      }
    };
  }, []);

  const handleScrollToField = useCallback(
    async (fieldPath: string, localized: boolean, locale?: string) => {
      // Cancel any pending hash clear from a previous field navigation.
      // This prevents a stale timeout from clearing the hash too early if
      // the user clicks multiple field mentions in quick succession.
      if (fieldPathClearTimeoutRef.current) {
        clearTimeout(fieldPathClearTimeoutRef.current);
        fieldPathClearTimeoutRef.current = null;
      }

      try {
        const modelId = ctx.itemType.id;
        const recordId = ctx.item?.id;

        if (!recordId) {
          // Record not saved yet
          return;
        }

        if (localized) {
          // For localized fields:
          // 1. First use scrollToField to switch to the correct locale
          const effectiveLocale = locale ?? ctx.locale;
          await ctx.scrollToField(fieldPath, effectiveLocale);

          // 2. Then navigate with the hash to highlight/expand the field
          // Check if locale is already embedded in the path (for nested fields in localized containers)
          // e.g., sections.it.0.hero_title already has "it" in the path
          const localeAlreadyInPath = effectiveLocale && fieldPath.includes(`.${effectiveLocale}.`);
          const fullPath = localeAlreadyInPath ? fieldPath : `${fieldPath}.${effectiveLocale}`;
          const path = `${buildRecordEditPath(modelId, recordId)}#fieldPath=${fullPath}`;
          await ctx.navigateTo(path);
        } else {
          // For non-localized fields, just use the hash navigation
          const path = `${buildRecordEditPath(modelId, recordId)}#fieldPath=${fieldPath}`;
          await ctx.navigateTo(path);
        }

        // Schedule cleanup of the fieldPath hash after a delay.
        // See FIELD_PATH_HASH_CLEAR_DELAY_MS documentation for rationale.
        //
        // NOTE: We must use ctx.navigateTo() to clear the hash, not window.history.replaceState().
        // The plugin runs in an iframe, so window.location refers to the iframe's URL,
        // not the parent DatoCMS app's URL where the hash actually lives.
        const pathWithoutHash = buildRecordEditPath(modelId, recordId);
        fieldPathClearTimeoutRef.current = setTimeout(() => {
          ctx.navigateTo(pathWithoutHash).catch(() => {
            // Silent failure - clearing the hash is a nice-to-have, not critical
          });
          fieldPathClearTimeoutRef.current = null;
        }, FIELD_PATH_HASH_CLEAR_DELAY_MS);
      } catch {
        // Intentionally silent: field navigation is a "best effort" operation.
        // Field may not exist, be hidden by permissions, be inside a collapsed block,
        // or the record may not be in an editable state. User feedback would be
        // confusing since clicking a field mention should feel like a soft hint,
        // not a guaranteed action.
      }
    },
    [ctx]
  );

  const handleOpenRecord = useCallback(
    async (recordId: string, _modelId: string) => {
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
