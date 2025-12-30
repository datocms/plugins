import { memo, type RefObject } from 'react';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import Comment from './Comment';
import { CommentErrorBoundary } from './shared/CommentErrorBoundary';
import type { CommentType } from '@ctypes/comments';
import type { CommentSegment } from '@ctypes/mentions';
import type { FieldInfo, UserInfo, ModelInfo } from '@hooks/useMentions';
import type { TipTapComposerRef } from './tiptap/TipTapComposer';
import type { TypedUserInfo } from '@utils/userDisplayResolver';
import styles from '@styles/commentbar.module.css';

type CommentsListProps = {
  comments: CommentType[];
  hasMoreComments: boolean;
  onLoadMore: () => void;
  currentUserEmail: string;
  modelFields: FieldInfo[];
  projectUsers: UserInfo[];
  projectModels: ModelInfo[];
  deleteComment: (id: string, parentCommentId?: string) => void;
  editComment: (id: string, newContent: CommentSegment[], parentCommentId?: string) => void;
  upvoteComment: (id: string, userUpvoted: boolean, parentCommentId?: string) => void;
  replyComment: (parentCommentId: string) => void;
  onPickerRequest?: (type: 'asset' | 'record', composerRef: RefObject<TipTapComposerRef | null>) => void;
  /** Callback when a model is selected for record mention - opens record picker */
  onRecordModelSelect?: (
    model: ModelInfo,
    composerRef: RefObject<TipTapComposerRef | null>
  ) => void;
  /** Models available for record mentions */
  readableModels?: ModelInfo[];
  canMentionAssets?: boolean;
  canMentionModels?: boolean;
  ctx: RenderItemFormSidebarCtx;
  /** When true, prevents empty replies from being auto-deleted on blur */
  isPickerActive?: boolean;
  /** Users with type information for upvoter name resolution */
  typedUsers?: TypedUserInfo[];
};

const CommentsListComponent = ({
  comments,
  hasMoreComments,
  onLoadMore,
  currentUserEmail,
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
  typedUsers,
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
            currentUserEmail={currentUserEmail}
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
            typedUsers={typedUsers}
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
