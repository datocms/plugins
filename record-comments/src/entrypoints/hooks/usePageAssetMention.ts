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

export function usePageAssetMention({
  ctx,
  composerRef,
  canMentionAssets = true,
}: UsePageAssetMentionParams): UsePageAssetMentionReturn {
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
