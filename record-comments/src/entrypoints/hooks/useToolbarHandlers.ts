import { useCallback, type RefObject } from 'react';
import type { TipTapComposerRef } from '@components/tiptap/TipTapComposer';

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

/**
 * Hook for toolbar button handlers.
 * Inserts trigger characters or opens pickers for mention types.
 *
 * Asset and record triggers are optional - when provided, they open
 * external pickers. When not provided, the handlers are no-ops.
 */
export function useToolbarHandlers({
  composerRef,
  canMentionModels = true,
  handleAssetTrigger,
  handleRecordTrigger,
}: UseToolbarHandlersParams): UseToolbarHandlersReturn {
  const handleUserToolbarClick = useCallback(() => {
    if (composerRef.current) {
      composerRef.current.insertText('@');
      composerRef.current.focus();
    }
  }, [composerRef]);

  const handleFieldToolbarClick = useCallback(() => {
    if (composerRef.current) {
      composerRef.current.insertText('#');
      composerRef.current.focus();
    }
  }, [composerRef]);

  const handleModelToolbarClick = useCallback(() => {
    if (canMentionModels && composerRef.current) {
      composerRef.current.insertText('$');
      composerRef.current.focus();
    }
  }, [composerRef, canMentionModels]);

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
