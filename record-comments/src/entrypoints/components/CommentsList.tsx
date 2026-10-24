import type { ResolvedCommentType } from '@ctypes/comments';
import type { CommentSegment } from '@ctypes/mentions';
import type { FieldInfo, ModelInfo, UserInfo } from '@hooks/useMentions';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import { memo, type RefObject } from 'react';
import Comment from './Comment';
import styles from './CommentsList.module.css';
import { CommentsIcon } from './Icons';
import { CommentErrorBoundary } from './shared/CommentErrorBoundary';
import { LoadMoreButton } from './shared/LoadMoreButton';
import type { TipTapComposerRef } from './tiptap/TipTapComposer';

type CommentsListProps = {
  comments: ResolvedCommentType[];
  hasMoreComments: boolean;
  onLoadMore: () => void;
  currentUserId: string;
  modelFields: FieldInfo[];
  fieldMentionsLoading?: boolean;
  fieldMentionsError?: string | null;
  onFieldMentionIntent?: () => void;
  onFieldMentionsRetry?: () => void;
  projectUsers: UserInfo[];
  /** The collaborators did not load yet */
  usersLoading?: boolean;
  /** The collaborators did not load */
  usersLoadFailed?: boolean;
  onUsersRetry?: () => void;
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
  fieldMentionsLoading,
  fieldMentionsError,
  onFieldMentionIntent,
  onFieldMentionsRetry,
  projectUsers,
  usersLoading,
  usersLoadFailed,
  onUsersRetry,
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
      <BlankSlate
        placement="section"
        small
        icon={<CommentsIcon />}
        title="No comments yet"
        description="The comments of your team about this record show here."
      />
    );
  }

  return (
    <div className={styles.root}>
      <ul aria-label="Comments" className={styles.list}>
        {comments.map((comment) => (
          <li key={comment.id}>
            <CommentErrorBoundary>
              <Comment
                deleteComment={deleteComment}
                editComment={editComment}
                upvoteComment={upvoteComment}
                replyComment={replyComment}
                commentObject={comment}
                currentUserId={currentUserId}
                modelFields={modelFields}
                fieldMentionsLoading={fieldMentionsLoading}
                fieldMentionsError={fieldMentionsError}
                onFieldMentionIntent={onFieldMentionIntent}
                onFieldMentionsRetry={onFieldMentionsRetry}
                projectUsers={projectUsers}
                usersLoading={usersLoading}
                usersLoadFailed={usersLoadFailed}
                onUsersRetry={onUsersRetry}
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
          </li>
        ))}
      </ul>
      {hasMoreComments && (
        <LoadMoreButton label="Load more comments" onClick={onLoadMore} />
      )}
    </div>
  );
};

const CommentsList = memo(CommentsListComponent);

export default CommentsList;
