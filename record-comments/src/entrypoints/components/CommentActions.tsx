import { Dropdown } from 'datocms-react-ui/Dropdown';
import IconTrigger from 'datocms-react-ui/Dropdown/triggers/IconTrigger';
import { memo } from 'react';
import { DeleteIcon, EditIcon, MoreVerticalIcon } from './Icons';

type CommentActionsProps = {
  onEdit: () => void;
  onDelete: () => void;
};

/**
 * The "⋮" of a comment, with Edit and Delete: only the author has it. The
 * comment decides when it shows (on hover and focus, always on touch).
 */
const CommentActions = memo(function CommentActions({
  onEdit,
  onDelete,
}: CommentActionsProps) {
  return (
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
  );
});

export default CommentActions;
