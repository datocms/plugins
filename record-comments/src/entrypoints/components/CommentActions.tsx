import styles from '@styles/comment.module.css';
import { memo } from 'react';
import { cn } from '@/utils/cn';
import {
  DeleteIcon,
  EditIcon,
  MoreVerticalIcon,
  ReplyIcon,
  UpvoteIcon,
} from './Icons';

type CommentActionsProps = {
  onUpvote: () => void;
  onReply?: () => void;
  onEdit: () => void;
  onDelete: () => void;
  userUpvoted: boolean;
  userIsAuthor: boolean;
  isTopLevel: boolean;
  hasUpvotes: boolean;
};

function arePropsEqual(
  prev: CommentActionsProps,
  next: CommentActionsProps,
): boolean {
  return (
    prev.userUpvoted === next.userUpvoted &&
    prev.userIsAuthor === next.userIsAuthor &&
    prev.isTopLevel === next.isTopLevel &&
    prev.hasUpvotes === next.hasUpvotes &&
    prev.onUpvote === next.onUpvote &&
    prev.onReply === next.onReply &&
    prev.onEdit === next.onEdit &&
    prev.onDelete === next.onDelete
  );
}

// CSS controls visibility; expose the revealed controls as a normal labeled action group.
const CommentActions = memo(function CommentActions({
  onUpvote,
  onReply,
  onEdit,
  onDelete,
  userUpvoted,
  userIsAuthor,
  isTopLevel,
  hasUpvotes,
}: CommentActionsProps) {
  return (
    <div className={styles.actionsWrapper}>
      <button
        type="button"
        className={styles.actionsTrigger}
        aria-label="Show comment actions"
      >
        <MoreVerticalIcon aria-hidden="true" />
      </button>
      <div className={styles.actions} role="group" aria-label="Comment actions">
        {!hasUpvotes && (
          <button
            type="button"
            className={cn(
              styles.actionBtn,
              userUpvoted && styles.actionBtnActive,
            )}
            onClick={onUpvote}
            aria-label={userUpvoted ? 'Remove upvote' : 'Upvote'}
          >
            <UpvoteIcon aria-hidden="true" />
          </button>
        )}

        {isTopLevel && onReply && (
          <button
            type="button"
            className={styles.actionBtn}
            onClick={onReply}
            aria-label="Reply to comment"
          >
            <ReplyIcon aria-hidden="true" />
          </button>
        )}

        {userIsAuthor && (
          <>
            <button
              type="button"
              className={styles.actionBtn}
              onClick={onEdit}
              aria-label="Edit comment"
            >
              <EditIcon aria-hidden="true" />
            </button>
            <button
              type="button"
              className={cn(styles.actionBtn, styles.actionBtnDanger)}
              onClick={onDelete}
              aria-label="Delete comment"
            >
              <DeleteIcon aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}, arePropsEqual);

export default CommentActions;
