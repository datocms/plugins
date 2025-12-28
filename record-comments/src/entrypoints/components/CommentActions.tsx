import { memo } from 'react';
import { cn } from '@/utils/cn';
import {
  MoreVerticalIcon,
  UpvoteIcon,
  ReplyIcon,
  EditIcon,
  DeleteIcon,
} from './Icons';
import styles from '@styles/comment.module.css';

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

/**
 * Custom comparator for CommentActions.
 * Only compares state-like props; callbacks are compared by reference.
 */
function arePropsEqual(prev: CommentActionsProps, next: CommentActionsProps): boolean {
  return (
    prev.userUpvoted === next.userUpvoted &&
    prev.userIsAuthor === next.userIsAuthor &&
    prev.isTopLevel === next.isTopLevel &&
    prev.hasUpvotes === next.hasUpvotes &&
    // Callbacks compared by reference (rely on useCallback stability)
    prev.onUpvote === next.onUpvote &&
    prev.onReply === next.onReply &&
    prev.onEdit === next.onEdit &&
    prev.onDelete === next.onDelete
  );
}

/**
 * Hover action buttons for comments (upvote, reply, edit, delete)
 *
 * Accessibility notes:
 * - This menu is CSS-based (hover-triggered), not JavaScript state-driven.
 * - Full arrow-key navigation would require managing focus state and menu open/close state in React.
 * - For now, menu items are focusable via Tab key and have proper ARIA roles.
 * - aria-expanded is statically set since visibility is controlled by CSS :hover.
 * - A more complete implementation would require refactoring to use useState for menu visibility.
 */
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
        aria-label="Comment actions menu"
        aria-haspopup="menu"
        aria-expanded="false"
      >
        <MoreVerticalIcon />
      </button>
      <div className={styles.actions} role="menu" aria-label="Comment actions">
        {/* Only show upvote button in hover menu if there are no upvotes yet */}
        {!hasUpvotes && (
          <button
            type="button"
            role="menuitem"
            className={cn(styles.actionBtn, userUpvoted && styles.actionBtnActive)}
            onClick={onUpvote}
            aria-label={userUpvoted ? 'Remove upvote' : 'Upvote'}
          >
            <UpvoteIcon aria-hidden="true" />
          </button>
        )}

        {isTopLevel && onReply && (
          <button
            type="button"
            role="menuitem"
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
              role="menuitem"
              className={styles.actionBtn}
              onClick={onEdit}
              aria-label="Edit comment"
            >
              <EditIcon aria-hidden="true" />
            </button>
            <button
              type="button"
              role="menuitem"
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
