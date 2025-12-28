import { useEffect, useRef, useState } from 'react';
import type { CommentSegment } from '@ctypes/mentions';
import type { TipTapComposerRef } from '@components/tiptap/TipTapComposer';

type UseCommentEditorParams = {
  commentContent: CommentSegment[];
  isNewComment: boolean;
};

export type UseCommentEditorReturn = {
  isEditing: boolean;
  setIsEditing: (editing: boolean) => void;
  segments: CommentSegment[];
  setSegments: (segments: CommentSegment[]) => void;
  composerRef: React.RefObject<TipTapComposerRef>;
  handleStartEditing: () => void;
  resetToOriginal: () => void;
};

/**
 * Hook for managing comment editing state
 * Handles the segments and editing mode for TipTapComposer
 */
export function useCommentEditor({
  commentContent,
  isNewComment,
}: UseCommentEditorParams): UseCommentEditorReturn {
  const composerRef = useRef<TipTapComposerRef>(null);

  // Use segments directly - no conversion needed
  const [isEditing, setIsEditing] = useState(isNewComment);
  const [segments, setSegments] = useState<CommentSegment[]>(commentContent);

  // Sync local state when props change (from realtime updates)
  useEffect(() => {
    if (!isEditing) {
      setSegments(commentContent);
    }
  }, [commentContent, isEditing]);

  // Auto-focus composer when editing starts
  useEffect(() => {
    if (isEditing && composerRef.current) {
      composerRef.current.focus();
    }
  }, [isEditing]);

  const handleStartEditing = () => {
    // Re-initialize from current content when starting to edit
    setSegments(commentContent);
    setIsEditing(true);
  };

  const resetToOriginal = () => {
    setSegments(commentContent);
    setIsEditing(false);
  };

  return {
    isEditing,
    setIsEditing,
    segments,
    setSegments,
    composerRef,
    handleStartEditing,
    resetToOriginal,
  };
}
