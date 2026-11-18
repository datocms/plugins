// The glyphs of the plugin, from Lucide, at 1em in the color of the text (see
// the LucideProvider in utils/render.tsx): the place sizes them.
import {
  CircleExclamationPoint,
  ListChecks,
  RefreshCw,
  Table2,
} from 'lucide-react';

/** The records of every model, like the 'table-2' icon of the sidebar item */
export const TableListIcon = Table2;

/** The status of an error */
export const CircleExclamationIcon = CircleExclamationPoint;

/** Do again: load the records again */
export const RefreshIcon = RefreshCw;

/** A stage of a workflow */
export const WorkflowStageIcon = ListChecks;
