import type { NodeProps } from '@xyflow/react';
import classNames from 'classnames';
import { useContext } from 'react';
import {
  type PluginNode,
  PluginNodeRenderer,
} from '@/components/PluginNodeRenderer';
import { EntitiesToExportContext } from '@/entrypoints/ExportPage/EntitiesToExportContext';

/**
 * Wraps the generic plugin renderer to flag nodes that are outside the current export selection.
 */
export function ExportPluginNodeRenderer(props: NodeProps<PluginNode>) {
  const { plugin } = props.data;

  const entitiesToExport = useContext(EntitiesToExportContext);

  return (
    <PluginNodeRenderer
      {...props}
      className={classNames(
        entitiesToExport &&
          !entitiesToExport.pluginIds.includes(plugin.id) &&
          'app-node--excluded',
      )}
    />
  );
}
