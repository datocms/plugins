import { useCallback, type RefObject } from 'react';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import type { AssetMention } from '@ctypes/mentions';
import type { TipTapComposerRef } from '@components/tiptap/TipTapComposer';
import { getThumbnailUrl } from '@/utils/helpers';
import { ERROR_MESSAGES } from '@/constants';
import { logError } from '@/utils/errorLogger';

export type UsePageAssetMentionParams = {
  ctx: RenderPageCtx;
  composerRef: RefObject<TipTapComposerRef | null>;
  canMentionAssets?: boolean;
};

type UsePageAssetMentionReturn = {
  handleAssetTrigger: () => Promise<void>;
  handleAssetClick: () => Promise<void>;
};

/**
 * Hook for handling asset mention functionality on page context.
 * Opens the DatoCMS asset picker and inserts the selected asset as a mention.
 *
 * ============================================================================
 * ARCHITECTURAL NOTE: WHY THIS HOOK DOESN'T UPDATE `mentionsMap`
 * ============================================================================
 *
 * This hook calls `composerRef.current?.insertMention(assetMention)` directly
 * without updating a `mentionsMap`. This is INTENTIONAL and NOT a bug.
 *
 * WHY THIS IS CORRECT:
 *
 * 1. This hook is used with TipTapComposer, NOT the plain textarea ComposerBox.
 *
 * 2. TipTap tracks mentions as ProseMirror document nodes, not in a separate map.
 *    When a mention is inserted via `insertMention()`, it becomes a node in the
 *    TipTap document structure.
 *
 * 3. On every content change, TipTapComposer calls `tipTapDocToSegments()` which
 *    walks the document tree and extracts ALL mentions from the node structure.
 *    This produces the `CommentSegment[]` array that gets saved to the server.
 *
 * 4. The `mentionsMap` used by `useMentionSelection` is ONLY for the plain textarea
 *    composer where mentions are tracked separately from the text content.
 *
 * DO NOT MODIFY THIS TO ADD mentionsMap HANDLING:
 * - It would require TipTapComposer to expose and manage a mentionsMap
 * - TipTap already provides reliable mention tracking via document nodes
 * - Adding dual tracking would create synchronization bugs
 *
 * If you need to understand how TipTap serializes mentions, see:
 * - `tipTapDocToSegments()` in utils/tipTapSerializer.ts
 * - `MENTION_NODE_TYPES` for the node type names
 * - `TipTapComposer.tsx` `insertMention()` method
 *
 * ============================================================================
 */
export function usePageAssetMention({
  ctx,
  composerRef,
  canMentionAssets = true,
}: UsePageAssetMentionParams): UsePageAssetMentionReturn {
  // Handle asset selection (both trigger and toolbar click)
  const selectAndInsertAsset = useCallback(async () => {
    if (!canMentionAssets) return;

    try {
      const upload = await ctx.selectUpload({ multiple: false });

      if (!upload) {
        composerRef.current?.focus();
        return;
      }

      const mimeType = upload.attributes.mime_type ?? 'application/octet-stream';
      const url = upload.attributes.url ?? '';
      const thumbnailUrl = getThumbnailUrl(mimeType, url, upload.attributes.mux_playback_id);

      const assetMention: AssetMention = {
        type: 'asset',
        id: upload.id,
        filename: upload.attributes.filename,
        url,
        thumbnailUrl,
        mimeType,
      };

      composerRef.current?.insertMention(assetMention);
    } catch (error) {
      logError('Asset picker error', error);
      ctx.alert(ERROR_MESSAGES.ASSET_PICKER_FAILED);
      composerRef.current?.focus();
    }
  }, [ctx, composerRef, canMentionAssets]);

  return {
    handleAssetTrigger: selectAndInsertAsset,
    handleAssetClick: selectAndInsertAsset,
  };
}
