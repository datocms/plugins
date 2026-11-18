import { CircleExclamationPoint, ListChecks, RefreshCw } from 'lucide-react';
import type { SVGProps } from 'react';
import { iconByName } from './lib/icons';
import { DEFAULT_ICON } from './lib/parameters';

// The plugin's icons, from Lucide. They are drawn at 1em, the size of the
// text around them (see the LucideProvider in utils/render.tsx); a button does
// not size its icon, a blank slate does.

/** Do again: load the records or the workflows again */
export const RefreshIcon = RefreshCw;

/** The status of an error */
export const CircleExclamationIcon = CircleExclamationPoint;

/** The stages of a workflow: the default icon of a stage page */
export const ListCheckIcon = ListChecks;

/**
 * The icon of a stage page: the one of its item in the content sidebar. A name
 * that the plugin does not offer shows the default icon.
 */
export function EntryIcon({
  name,
  ...props
}: { name?: string } & SVGProps<SVGSVGElement>) {
  const Icon = iconByName(name ?? DEFAULT_ICON)?.icon ?? ListChecks;
  return <Icon {...props} />;
}
