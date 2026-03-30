import { useState, useCallback, useRef, type RefObject } from 'react';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import type { Client } from '@datocms/cma-client-browser';
import type { TipTapComposerRef } from '@components/tiptap/TipTapComposer';
import type { ModelInfo } from './useMentions';
import { createRecordMention } from '@utils/recordPickerHelpers';
import { createAssetMention } from '@utils/composerHelpers';
import { insertMentionWithRetry } from '@utils/textareaUtils';
import { ERROR_MESSAGES } from '@/constants';
import { logError, logWarn } from '@/utils/errorLogger';

export type UseReplyPickerParams = {
  ctx: RenderItemFormSidebarCtx;
  client: Client | null;
  canMentionAssets: boolean;
};

type UseReplyPickerReturn = {
  isPickerInProgress: boolean;
  handleReplyPickerRequest: (
    type: 'asset' | 'record',
    replyComposerRef: RefObject<TipTapComposerRef | null>
  ) => Promise<void>;
  handleRecordModelSelectFromComment: (
    model: ModelInfo,
    targetComposerRef: RefObject<TipTapComposerRef | null>
  ) => Promise<void>;
};

/**
 * Shared hook for handling asset and record picker requests from reply composers.
 */
export function useReplyPicker({
  ctx,
  client,
  canMentionAssets,
}: UseReplyPickerParams): UseReplyPickerReturn {
  const [isPickerInProgress, setIsPickerInProgress] = useState(false);
  const activeReplyComposerRef = useRef<TipTapComposerRef | null>(null);

  const handleReplyPickerRequest = useCallback(
    async (
      type: 'asset' | 'record',
      replyComposerRef: RefObject<TipTapComposerRef | null>
    ) => {
      // Record mentions are handled by the Comment component's own dropdown
      if (type !== 'asset') return;
      if (!canMentionAssets) return;

      activeReplyComposerRef.current = replyComposerRef.current;
      setIsPickerInProgress(true);

      try {
        const upload = await ctx.selectUpload({ multiple: false });
        if (!upload) {
          activeReplyComposerRef.current?.focus();
          return;
        }

        const assetMention = createAssetMention(upload);
        await insertMentionWithRetry(activeReplyComposerRef, assetMention);
      } catch (error) {
        logError('Reply asset picker error:', error);
        ctx.alert(ERROR_MESSAGES.ASSET_PICKER_FAILED);
        activeReplyComposerRef.current?.focus();
      } finally {
        setIsPickerInProgress(false);
        activeReplyComposerRef.current = null;
      }
    },
    [ctx, canMentionAssets]
  );

  const handleRecordModelSelectFromComment = useCallback(
    async (
      model: ModelInfo,
      targetComposerRef: RefObject<TipTapComposerRef | null>
    ) => {
      const targetComposer = targetComposerRef.current;
      if (!targetComposer) {
        logWarn('No valid composer target for record mention from comment, aborting');
        return;
      }

      setIsPickerInProgress(true);

      try {
        const record = await ctx.selectItem(model.id, { multiple: false });
        if (!record) {
          targetComposer.focus();
          return;
        }

        const itemType = ctx.itemTypes[model.id];

        let fields: Awaited<ReturnType<typeof ctx.loadItemTypeFields>> = [];
        if (itemType) {
          try {
            fields = await ctx.loadItemTypeFields(model.id);
          } catch (fieldError) {
            logError('Failed to load item type fields for record mention', fieldError, { modelId: model.id });
          }
        }

        const mainLocale = ctx.site.attributes.locales[0] ?? 'en';

        const recordMention = await createRecordMention(
          { id: record.id, attributes: record.attributes },
          { id: model.id, apiKey: model.apiKey, name: model.name, isBlockModel: model.isBlockModel },
          itemType,
          fields,
          mainLocale,
          client
        );

        await insertMentionWithRetry(targetComposerRef, recordMention);
      } catch (error) {
        logError('Reply record picker error:', error);
        ctx.alert(ERROR_MESSAGES.RECORD_PICKER_FAILED);
      } finally {
        setIsPickerInProgress(false);
      }
    },
    [ctx, client]
  );

  return {
    isPickerInProgress,
    handleReplyPickerRequest,
    handleRecordModelSelectFromComment,
  };
}
