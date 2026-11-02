import type { NodeProps } from '@xyflow/react';
import classNames from 'classnames';
import Pill from 'datocms-react-ui/Pill';
import { useContext } from 'react';
import { nodeState } from '@/components/nodeState';
import {
  type PluginNode,
  PluginNodeRenderer,
} from '@/components/PluginNodeRenderer';
import { SelectedEntityContext } from '@/components/SchemaOverview/SelectedEntityContext';
import { UnresolvedConflictsContext } from '@/entrypoints/ImportPage/ConflictsManager/ConflictsContext';
import { useResolutionStatusForPlugin } from './ResolutionsForm';

/**
 * A plugin node of the import graph: with a "Conflict" pill while its row in
 * the overview says so (a name, a URL or an ID to decide about), faded once
 * the import reuses or skips it (with a "Uses installed" or "Skipped" pill),
 * in the selected colors when it is the focused entity.
 */
export function ImportPluginNodeRenderer(props: NodeProps<PluginNode>) {
  const { plugin } = props.data;

  const unresolvedConflict = useContext(
    UnresolvedConflictsContext,
  ).pluginIds.has(plugin.id);
  const selectedEntityContext = useContext(SelectedEntityContext);
  const resolution = useResolutionStatusForPlugin(plugin.id);

  // Only a plugin installed in the project has these choices
  const strategy = unresolvedConflict
    ? undefined
    : resolution?.values?.strategy;
  const notCreated = strategy === 'reuseExisting' || strategy === 'skip';

  return (
    <PluginNodeRenderer
      {...props}
      className={classNames(
        notCreated && nodeState.excluded,
        selectedEntityContext.entity === plugin && nodeState.focused,
      )}
      status={
        unresolvedConflict ? (
          <Pill tone="warning">Conflict</Pill>
        ) : strategy === 'reuseExisting' ? (
          <Pill>Uses installed</Pill>
        ) : strategy === 'skip' ? (
          <Pill>Skipped</Pill>
        ) : undefined
      }
    />
  );
}
