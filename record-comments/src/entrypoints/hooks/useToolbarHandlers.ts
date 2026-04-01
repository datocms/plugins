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
  // Insert complete slash commands to skip the command menu and go straight to type selection
  const handleUserToolbarClick = useCallback(() => {
    if (composerRef.current) {
      composerRef.current.insertText('/user ');
      composerRef.current.focus();
    }
  }, [composerRef]);

  const handleFieldToolbarClick = useCallback(() => {
    if (composerRef.current) {
      composerRef.current.insertText('/field ');
      composerRef.current.focus();
    }
  }, [composerRef]);

  const handleModelToolbarClick = useCallback(() => {
    if (canMentionModels && composerRef.current) {
      composerRef.current.insertText('/model ');
      composerRef.current.focus();
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
