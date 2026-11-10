import type { NodeProps } from '@xyflow/react';
import classNames from 'classnames';
import { useContext } from 'react';
import { nodeState } from '@/components/nodeState';
import {
  type PluginNode,
  PluginNodeRenderer,
} from '@/components/PluginNodeRenderer';
import { SelectedEntityContext } from '@/components/SchemaOverview/SelectedEntityContext';
import { EntitiesToExportContext } from '@/entrypoints/ExportPage/EntitiesToExportContext';
import { ExportStatePill } from './ExportStatePill';
import { pluginExportState } from './exportState';

/**
 * A plugin node of the export graph: tinted with a checked pill when it is
 * in the file, dashed and muted with a "Not exported" pill when it is not,
 * with a ring when it is the focused entity.
 */
export function ExportPluginNodeRenderer(props: NodeProps<PluginNode>) {
  const { plugin } = props.data;
  const selection = useContext(EntitiesToExportContext);
  const selectedEntityContext = useContext(SelectedEntityContext);

  const state = selection ? pluginExportState(selection, plugin.id) : undefined;

  return (
    <PluginNodeRenderer
      {...props}
      className={classNames(
        state === 'excluded' && nodeState.excluded,
        state && state !== 'excluded' && nodeState.included,
        selectedEntityContext.entity === plugin && nodeState.current,
      )}
      status={state ? <ExportStatePill state={state} /> : undefined}
      statusPlacement="bottom"
    />
  );
}
