import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  ArrowUp,
  CircleAlert,
  EllipsisVertical,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';

// The plugin's icons, from Lucide. They are drawn at 1em, the size of the
// text around them (see the LucideProvider in utils/render.tsx).

/** Adds something */
export const AddIcon = Plus;
/** The "⋮" of a row or card */
export const ActionToggleIcon = EllipsisVertical;
/** Edits something */
export const EditIcon = Pencil;
/** Replaces something with another */
export const ReplaceIcon = ArrowRightLeft;
/** Deletes something the user made */
export const DeleteIcon = Trash2;
/** Moves something earlier in an order */
export const MoveUpIcon = ArrowUp;
/** Moves something later in an order */
export const MoveDownIcon = ArrowDown;
/** Moves something one column to the left */
export const MoveLeftIcon = ArrowLeft;
/** Moves something one column to the right */
export const MoveRightIcon = ArrowRight;
/** A problem */
export const WarningIcon = CircleAlert;
