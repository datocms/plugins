import Button from 'datocms-react-ui/Button';
import { Dropdown } from 'datocms-react-ui/Dropdown';
import IconTrigger from 'datocms-react-ui/Dropdown/triggers/IconTrigger';
import { memo } from 'react';
import styles from './CommentActions.module.css';
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

/**
 * The actions on one comment. Upvote shows until the comment has its first
 * upvote (then the reaction under the text takes its place), Reply only on a
 * top-level comment, and the "⋮" with Edit and Delete only to the author. The
 * comment decides when the group shows (on hover and focus, always on touch).
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
  const canUpvote = !hasUpvotes;
  const canReply = isTopLevel && onReply !== undefined;

  if (!canUpvote && !canReply && !userIsAuthor) {
    return null;
  }

  return (
    <div className={styles.group} role="group" aria-label="Comment actions">
      {canUpvote && (
        <Button
          tone="ghost"
          size="micro"
          iconOnly
          icon={UpvoteIcon}
          label={userUpvoted ? 'Remove upvote' : 'Upvote'}
          pressed={userUpvoted}
          onClick={onUpvote}
        />
      )}
      {canReply && (
        <Button
          tone="ghost"
          size="micro"
          iconOnly
          icon={ReplyIcon}
          label="Reply"
          onClick={onReply}
        />
      )}
      {userIsAuthor && (
        <Dropdown triggerComponent={IconTrigger} icon={MoreVerticalIcon}>
          <Dropdown.Menu placement="bottom-end">
            <Dropdown.Option icon={<EditIcon />} onPick={onEdit}>
              Edit
            </Dropdown.Option>
            <Dropdown.Separator />
            <Dropdown.Option icon={<DeleteIcon />} alert onPick={onDelete}>
              Delete
            </Dropdown.Option>
          </Dropdown.Menu>
        </Dropdown>
      )}
    </div>
  );
}, arePropsEqual);

export default CommentActions;
