import {
  type PluginNode,
  PluginNodeRenderer,
} from '@/components/PluginNodeRenderer';
import { ConflictsContext } from '@/entrypoints/ImportPage/ConflictsManager/ConflictsContext';
import { SelectedEntityContext } from '@/entrypoints/ImportPage/SelectedEntityContext';
import type { NodeProps } from '@xyflow/react';
import classNames from 'classnames';
import { useContext } from 'react';
import { useResolutionStatusForPlugin } from './ResolutionsForm';

export function ImportPluginNodeRenderer(props: NodeProps<PluginNode>) {
  const { plugin } = props.data;

  const conflict = useContext(ConflictsContext).plugins[plugin.id];
  const selectedEntityContext = useContext(SelectedEntityContext);
  const resolution = useResolutionStatusForPlugin(plugin.id);

  return (
    <PluginNodeRenderer
      {...props}
      className={classNames(
        conflict && resolution?.invalid && 'app-node--conflict',
        conflict && !resolution?.invalid && 'app-node__excluded-from-export',
        selectedEntityContext.entity === plugin && 'app-node__focused',
      )}
    />
  );
}
