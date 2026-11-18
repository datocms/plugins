import {
  ArrowDown,
  ArrowUp,
  EllipsisVertical,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';

// The plugin's icons, all from Lucide. They are drawn at 1em, the size of the
// text around them (see the LucideProvider in utils/render.tsx).

/** Move a task down */
export const ArrowDownIcon = ArrowDown;
/** Move a task up */
export const ArrowUpIcon = ArrowUp;
/** Delete a task */
export const DeleteIcon = Trash2;
/** Edit the text of a task */
export const EditIcon = Pencil;
/** The actions of a task ("⋮") */
export const EllipsisVerticalIcon = EllipsisVertical;
/** Add a task */
export const PlusIcon = Plus;
