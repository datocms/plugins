import { useState, useCallback, useRef, type RefObject } from 'react';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import type { Client } from '@datocms/cma-client-browser';
import type { TipTapComposerRef } from '@components/tiptap/TipTapComposer';
import type { ModelInfo } from './useMentions';
import { createRecordMention } from '@utils/recordPickerHelpers';
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

export function usePageRecordMention({
  ctx,
  client,
  composerRef,
}: UsePageRecordMentionParams): UsePageRecordMentionReturn {
  const [isRecordModelSelectorOpen, setIsRecordModelSelectorOpen] = useState(false);

  const operationIdRef = useRef(0);

  const handleRecordTrigger = useCallback(() => {
    setIsRecordModelSelectorOpen(true);
  }, []);

  const handleRecordModelSelect = useCallback(
    async (model: ModelInfo) => {
      setIsRecordModelSelectorOpen(false);

      operationIdRef.current += 1;
      const currentOperationId = operationIdRef.current;

      try {
        const record = await ctx.selectItem(model.id, { multiple: false });

        if (currentOperationId !== operationIdRef.current) {
          return;
        }

        if (!record) {
          composerRef.current?.focus();
          return;
        }

        const itemType = ctx.itemTypes[model.id];
        const fields = itemType ? await ctx.loadItemTypeFields(model.id) : [];
        const mainLocale = ctx.site.attributes.locales[0];

        const recordMention = await createRecordMention(
          { id: record.id, attributes: record.attributes },
          { id: model.id, apiKey: model.apiKey, name: model.name, isBlockModel: model.isBlockModel },
          itemType,
          fields,
          mainLocale,
          client
        );

        if (currentOperationId !== operationIdRef.current) {
          return;
        }

        composerRef.current?.insertMention(recordMention);
      } catch (error) {
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
