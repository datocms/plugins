import { useState, useCallback, useRef, type RefObject } from 'react';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import type { Client } from '@datocms/cma-client-browser';
import type { TipTapComposerRef } from '@components/tiptap/TipTapComposer';
import type { ModelInfo } from './useMentions';
import { createRecordMention } from '@utils/recordPickerHelpers';
import { getItemTypeEmoji } from '@utils/itemTypeUtils';
import { ERROR_MESSAGES } from '@/constants';
import { logError } from '@/utils/errorLogger';

export type UsePageRecordMentionParams = {
  ctx: RenderPageCtx;
  client: Client | null;
  composerRef: RefObject<TipTapComposerRef | null>;
  projectModels: ModelInfo[];
};

type UsePageRecordMentionReturn = {
  isRecordModelSelectorOpen: boolean;
  setIsRecordModelSelectorOpen: (open: boolean) => void;
  handleRecordTrigger: () => void;
  handleRecordModelSelect: (model: ModelInfo) => Promise<void>;
  handleRecordModelSelectorClose: () => void;
};

/**
 * Hook for handling record mention functionality on page context.
 * Manages the record model selector and record picker.
 *
 * ============================================================================
 * ARCHITECTURAL NOTE: WHY THIS HOOK DOESN'T UPDATE `mentionsMap`
 * ============================================================================
 *
 * This hook calls `composerRef.current?.insertMention(recordMention)` directly
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
export function usePageRecordMention({
  ctx,
  client,
  composerRef,
}: UsePageRecordMentionParams): UsePageRecordMentionReturn {
  const [isRecordModelSelectorOpen, setIsRecordModelSelectorOpen] = useState(false);

  // Operation counter to prevent race conditions when user rapidly selects models.
  // Each call to handleRecordModelSelect increments this, and stale operations
  // check if their captured ID still matches the current one before inserting.
  const operationIdRef = useRef(0);

  // Opens the model selector (used by both trigger character and toolbar click)
  const handleRecordTrigger = useCallback(() => {
    setIsRecordModelSelectorOpen(true);
  }, []);

  const handleRecordModelSelect = useCallback(
    async (model: ModelInfo) => {
      setIsRecordModelSelectorOpen(false);

      // Increment and capture the current operation ID
      operationIdRef.current += 1;
      const currentOperationId = operationIdRef.current;

      try {
        const record = await ctx.selectItem(model.id, { multiple: false });

        // Check if this operation is still current after the async picker
        if (currentOperationId !== operationIdRef.current) {
          return; // A newer operation has started, discard this one
        }

        if (!record) {
          composerRef.current?.focus();
          return;
        }

        const itemType = ctx.itemTypes[model.id];
        const fields = itemType ? await ctx.loadItemTypeFields(model.id) : [];
        const mainLocale = ctx.site.attributes.locales[0];
        const modelEmoji = getItemTypeEmoji(itemType);

        const recordMention = await createRecordMention(
          { id: record.id, attributes: record.attributes },
          { id: model.id, apiKey: model.apiKey, name: model.name, isBlockModel: model.isBlockModel },
          itemType,
          fields,
          mainLocale,
          client,
          modelEmoji
        );

        // Final check before inserting - ensure this is still the current operation
        if (currentOperationId !== operationIdRef.current) {
          return; // A newer operation has started, discard this one
        }

        composerRef.current?.insertMention(recordMention);
      } catch (error) {
        // Only show error if this is still the current operation
        if (currentOperationId === operationIdRef.current) {
          logError('Record picker error', error);
          ctx.alert(ERROR_MESSAGES.RECORD_PICKER_FAILED);
          composerRef.current?.focus();
        }
      }
    },
    [ctx, client, composerRef]
  );

  const handleRecordModelSelectorClose = useCallback(() => {
    setIsRecordModelSelectorOpen(false);
    composerRef.current?.focus();
  }, [composerRef]);

  return {
    isRecordModelSelectorOpen,
    setIsRecordModelSelectorOpen,
    handleRecordTrigger,
    handleRecordModelSelect,
    handleRecordModelSelectorClose,
  };
}
