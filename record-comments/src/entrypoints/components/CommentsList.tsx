import type { ResolvedCommentType } from '@ctypes/comments';
import type { CommentSegment } from '@ctypes/mentions';
import type { FieldInfo, ModelInfo, UserInfo } from '@hooks/useMentions';
import styles from '@styles/commentbar.module.css';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import { memo, type RefObject } from 'react';
import Comment from './Comment';
import { CommentErrorBoundary } from './shared/CommentErrorBoundary';
import type { TipTapComposerRef } from './tiptap/TipTapComposer';

type CommentsListProps = {
  comments: ResolvedCommentType[];
  hasMoreComments: boolean;
  onLoadMore: () => void;
  currentUserId: string;
  modelFields: FieldInfo[];
  projectUsers: UserInfo[];
  projectModels: ModelInfo[];
  deleteComment: (id: string, parentCommentId?: string) => boolean;
  editComment: (
    id: string,
    newContent: CommentSegment[],
    parentCommentId?: string,
  ) => boolean;
  upvoteComment: (
    id: string,
    userUpvoted: boolean,
    parentCommentId?: string,
  ) => boolean;
  replyComment: (parentCommentId: string) => boolean;
  onPickerRequest?: (
    type: 'asset' | 'record',
    composerRef: RefObject<TipTapComposerRef | null>,
  ) => void;
  /** Callback when a model is selected for record mention - opens record picker */
  onRecordModelSelect?: (
    model: ModelInfo,
    composerRef: RefObject<TipTapComposerRef | null>,
  ) => void;
  /** Models available for record mentions */
  readableModels?: ModelInfo[];
  canMentionAssets?: boolean;
  canMentionModels?: boolean;
  ctx: RenderItemFormSidebarCtx;
  /** When true, prevents empty replies from being auto-deleted on blur */
  isPickerActive?: boolean;
};

const CommentsListComponent = ({
  comments,
  hasMoreComments,
  onLoadMore,
  currentUserId,
  modelFields,
  projectUsers,
  projectModels,
  deleteComment,
  editComment,
  upvoteComment,
  replyComment,
  onPickerRequest,
  onRecordModelSelect,
  readableModels,
  canMentionAssets,
  canMentionModels,
  ctx,
  isPickerActive,
}: CommentsListProps) => {
  if (comments.length === 0) {
    return (
      <div className={styles.empty}>
        <p>No comments yet</p>
        <span>Be the first to leave a comment on this record.</span>
      </div>
    );
  }

  return (
    <div className={styles.commentsList}>
      {comments.map((comment) => (
        <CommentErrorBoundary key={comment.id}>
          <Comment
            deleteComment={deleteComment}
            editComment={editComment}
            upvoteComment={upvoteComment}
            replyComment={replyComment}
            commentObject={comment}
            currentUserId={currentUserId}
            modelFields={modelFields}
            projectUsers={projectUsers}
            projectModels={projectModels}
            onPickerRequest={onPickerRequest}
            onRecordModelSelect={onRecordModelSelect}
            readableModels={readableModels}
            canMentionAssets={canMentionAssets}
            canMentionModels={canMentionModels}
            ctx={ctx}
            isPickerActive={isPickerActive}
          />
        </CommentErrorBoundary>
      ))}
      {hasMoreComments && (
        <button
          type="button"
          className={styles.loadMoreButton}
          onClick={onLoadMore}
        >
          Load more comments
        </button>
      )}
    </div>
  );
};

const CommentsList = memo(CommentsListComponent);

export default CommentsList;
