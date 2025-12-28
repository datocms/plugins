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

/**
 * Hook for navigation-related callbacks for page context (Comments Dashboard).
 *
 * See useNavigationCallbacksBase for rationale on why this is a separate hook
 * rather than a parameterized version of useNavigationCallbacks.
 *
 * Page-specific differences:
 * - No handleScrollToField: There's no record context in the page view
 * - handleOpenRecord: Uses ctx.navigateTo() since ctx.editItem isn't available
 * - handleNavigateToRecordComments: Navigate to a record with comments sidebar
 */
export function usePageNavigationCallbacks(ctx: RenderPageCtx): UsePageNavigationCallbacksReturn {
  const base = useNavigationCallbacksBase(ctx);

  const handleOpenRecord = useCallback(
    async (recordId: string, modelId: string) => {
      const path = buildRecordEditPath(modelId, recordId);
      await ctx.navigateTo(path);
    },
    [ctx]
  );

  /**
   * Navigate to a specific record with the comments sidebar open.
   * Used when clicking on comments in My Mentions or Recent Comments.
   *
   * ============================================================================
   * WHY THIS IS NOT MERGED WITH handleOpenRecord - DO NOT CONSOLIDATE
   * ============================================================================
   *
   * This function appears identical to handleOpenRecord, but they are kept
   * separate intentionally:
   *
   * 1. SEMANTIC DISTINCTION: Different call sites have different intent:
   *    - handleOpenRecord: Opens a record to view/edit it (from mention clicks)
   *    - handleNavigateToRecordComments: Opens a record TO SEE ITS COMMENTS
   *
   * 2. FUTURE-PROOFING: When DatoCMS adds sidebar auto-open capability,
   *    this function will need to pass a query param or hash to auto-open
   *    the comments panel. handleOpenRecord should NOT auto-open sidebars.
   *
   * 3. DIFFERENT PARAMETER ORDER: Notice (recordId, modelId) vs (modelId, recordId)
   *    Merging would require either breaking call sites or a confusing adapter.
   *
   * 4. TRACEABLE INTENT: When debugging navigation issues, seeing
   *    "handleNavigateToRecordComments" in the call stack immediately tells
   *    you WHY the navigation happened, not just WHAT happened.
   *
   * IMPLEMENTATION: Currently identical because DatoCMS doesn't yet support
   * auto-opening specific sidebars via URL. When it does, update this function.
   * ============================================================================
   */
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
