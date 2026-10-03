import type { TipTapComposerRef } from '@components/tiptap/TipTapComposer';
import type { CommentSegment, StoredCommentSegment } from '@ctypes/mentions';
import { segmentsToStoredSegments } from '@utils/tipTapSerializer';
import { useEffect, useRef, useState } from 'react';

type UseCommentEditorParams = {
  commentContent: CommentSegment[];
  storedCommentContent?: StoredCommentSegment[];
  isNewComment: boolean;
};

export type UseCommentEditorReturn = {
  isEditing: boolean;
  setIsEditing: (editing: boolean) => void;
  segments: CommentSegment[];
  editBaselineContent: StoredCommentSegment[];
  setSegments: (segments: CommentSegment[]) => void;
  composerRef: React.RefObject<TipTapComposerRef | null>;
  handleStartEditing: () => void;
  resetToOriginal: () => void;
};

export function useCommentEditor({
  commentContent,
  storedCommentContent,
  isNewComment,
}: UseCommentEditorParams): UseCommentEditorReturn {
  const composerRef = useRef<TipTapComposerRef>(null);
  const [isEditing, setIsEditing] = useState(isNewComment);
  const [segments, setSegments] = useState(commentContent);
  const editBaselineContentRef = useRef(
    storedCommentContent ?? segmentsToStoredSegments(commentContent),
  );

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
    editBaselineContentRef.current =
      storedCommentContent ?? segmentsToStoredSegments(commentContent);
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
    editBaselineContent: editBaselineContentRef.current,
    setSegments,
    composerRef,
    handleStartEditing,
    resetToOriginal,
  };
}
