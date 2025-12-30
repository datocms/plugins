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

export function useCommentEditor({
  commentContent,
  isNewComment,
}: UseCommentEditorParams): UseCommentEditorReturn {
  const composerRef = useRef<TipTapComposerRef>(null);
  const [isEditing, setIsEditing] = useState(isNewComment);
  const [segments, setSegments] = useState<CommentSegment[]>(commentContent);

  useEffect(() => {
    if (!isEditing) {
      setSegments(commentContent);
    }
  }, [commentContent, isEditing]);

  useEffect(() => {
    if (isEditing && composerRef.current) {
      composerRef.current.focus();
    }
  }, [isEditing]);

  const handleStartEditing = () => {
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
