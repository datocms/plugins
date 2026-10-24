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
import { EntitiesToExportContext } from '@/entrypoints/ExportPage/EntitiesToExportContext';

/**
 * A plugin node of the export graph: faded, with a "Not included" pill, when
 * it is out of the export, in the selected colors when it is the focused
 * entity.
 */
export function ExportPluginNodeRenderer(props: NodeProps<PluginNode>) {
  const { plugin } = props.data;

  const entitiesToExport = useContext(EntitiesToExportContext);
  const selectedEntityContext = useContext(SelectedEntityContext);

  const excluded =
    entitiesToExport && !entitiesToExport.pluginIds.includes(plugin.id);

  return (
    <PluginNodeRenderer
      {...props}
      className={classNames(
        excluded && nodeState.excluded,
        selectedEntityContext.entity === plugin && nodeState.focused,
      )}
      status={excluded ? <Pill>Not included</Pill> : undefined}
    />
  );
}
