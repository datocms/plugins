import {
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  CircleExclamationPoint,
  EllipsisVertical,
  Image,
  Plus,
  ShoppingBag,
  Trash,
} from 'lucide-react';

// The plugin's icons, from Lucide. Like the kit's own icons they are 1em, the
// size of the text around them (see the LucideProvider in utils/render.tsx):
// a component that needs another size sets it.

/** Actions on a reference ("⋮") */
export const EllipsisVerticalIcon = EllipsisVertical;

/** Choose or add references */
export const PlusIcon = Plus;

/** Remove a reference from the field */
export const TrashIcon = Trash;

/** Replace a reference */
export const ArrowRightArrowLeftIcon = ArrowRightLeft;

/** Move a reference up */
export const ArrowUpIcon = ArrowUp;

/** Move a reference down */
export const ArrowDownIcon = ArrowDown;

/** The status of an error */
export const CircleExclamationIcon = CircleExclamationPoint;

/** A product with no image, or one that fails to load */
export const ImageIcon = Image;

/** Products */
export const BagShoppingIcon = ShoppingBag;
