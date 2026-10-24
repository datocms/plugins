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
import { ConflictsContext } from '@/entrypoints/ImportPage/ConflictsManager/ConflictsContext';
import { useResolutionStatusForPlugin } from './ResolutionsForm';

/**
 * A plugin node of the import graph: in the danger colors with a "Conflict"
 * pill while its conflict is unresolved, faded once the conflict is resolved
 * (with a "Uses installed" or "Skipped" pill), in the selected colors when it
 * is the focused entity.
 */
export function ImportPluginNodeRenderer(props: NodeProps<PluginNode>) {
  const { plugin } = props.data;

  const conflict = useContext(ConflictsContext).plugins[plugin.id];
  const selectedEntityContext = useContext(SelectedEntityContext);
  const resolution = useResolutionStatusForPlugin(plugin.id);

  const unresolvedConflict = conflict && resolution?.invalid;
  const resolvedConflict = conflict && !resolution?.invalid;
  const strategy = resolution?.values?.strategy;

  return (
    <PluginNodeRenderer
      {...props}
      className={classNames(
        unresolvedConflict && nodeState.conflict,
        resolvedConflict && nodeState.excluded,
        selectedEntityContext.entity === plugin && nodeState.focused,
      )}
      status={
        unresolvedConflict ? (
          <Pill tone="danger">Conflict</Pill>
        ) : resolvedConflict && strategy === 'reuseExisting' ? (
          <Pill>Uses installed</Pill>
        ) : resolvedConflict && strategy === 'skip' ? (
          <Pill>Skipped</Pill>
        ) : undefined
      }
    />
  );
}
