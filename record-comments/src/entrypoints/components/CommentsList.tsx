import { memo, type RefObject } from 'react';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import Comment from './Comment';
import { CommentErrorBoundary } from './shared/CommentErrorBoundary';
import type { CommentType } from '@ctypes/comments';
import type { CommentSegment } from '@ctypes/mentions';
import type { FieldInfo, UserInfo, ModelInfo } from '@hooks/useMentions';
import type { TipTapComposerRef } from './tiptap/TipTapComposer';
import type { UserOverrides } from '@utils/pluginParams';
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
  canMentionAssets?: boolean;
  canMentionModels?: boolean;
  ctx: RenderItemFormSidebarCtx;
  /** When true, prevents empty replies from being auto-deleted on blur */
  isPickerActive?: boolean;
  /** User overrides for custom names/avatars */
  userOverrides?: UserOverrides;
  /** Users with type information for override resolution */
  typedUsers?: TypedUserInfo[];
};

/**
 * Component to render the list of comments with pagination.
 * Extracted from CommentsBar for better maintainability.
 *
 * NOTE: No virtualization is currently implemented. This is acceptable because:
 * - Sidebar pagination limits display to ~30 items at a time
 * - Dashboard filtering typically shows fewer than 100 comments
 *
 * If performance issues arise with large comment counts (>100 visible),
 * consider adding react-window or similar virtualization library.
 */
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
  canMentionAssets,
  canMentionModels,
  ctx,
  isPickerActive,
  userOverrides,
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
            canMentionAssets={canMentionAssets}
            canMentionModels={canMentionModels}
            ctx={ctx}
            isPickerActive={isPickerActive}
            userOverrides={userOverrides}
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

/**
 * Memoized CommentsList to prevent unnecessary re-renders when parent updates
 * but comments/callbacks haven't changed.
 */
const CommentsList = memo(CommentsListComponent);

export default CommentsList;
