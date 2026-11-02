import type { TipTapComposerRef } from '@components/tiptap/TipTapComposer';
import { type RefObject, useCallback } from 'react';

type UseToolbarHandlersParams = {
  composerRef: RefObject<TipTapComposerRef | null>;
  canMentionModels?: boolean;
  handleAssetTrigger?: () => void;
  handleRecordTrigger?: () => void;
};

type UseToolbarHandlersReturn = {
  handleUserToolbarClick: () => void;
  handleFieldToolbarClick: () => void;
  handleModelToolbarClick: () => void;
  handleAssetToolbarClick: () => void;
  handleRecordToolbarClick: () => void;
};

export function useToolbarHandlers({
  composerRef,
  canMentionModels = true,
  handleAssetTrigger,
  handleRecordTrigger,
}: UseToolbarHandlersParams): UseToolbarHandlersReturn {
  // The panel opens with its search field, which takes the focus
  const handleUserToolbarClick = useCallback(() => {
    composerRef.current?.triggerMentionType('user');
  }, [composerRef]);

  const handleFieldToolbarClick = useCallback(() => {
    composerRef.current?.triggerMentionType('field');
  }, [composerRef]);

  const handleModelToolbarClick = useCallback(() => {
    if (canMentionModels) {
      composerRef.current?.triggerMentionType('model');
    }
  }, [composerRef, canMentionModels]);

  // Records and assets use external pickers (same as slash command selection)
  const handleAssetToolbarClick = useCallback(() => {
    handleAssetTrigger?.();
  }, [handleAssetTrigger]);

  const handleRecordToolbarClick = useCallback(() => {
    handleRecordTrigger?.();
  }, [handleRecordTrigger]);

  return {
    handleUserToolbarClick,
    handleFieldToolbarClick,
    handleModelToolbarClick,
    handleAssetToolbarClick,
    handleRecordToolbarClick,
  };
}
