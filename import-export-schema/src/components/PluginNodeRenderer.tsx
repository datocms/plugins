import { EntitiesToExportContext } from '@/entrypoints/ExportPage/EntitiesToExportContext';
import { ConflictsContext } from '@/entrypoints/ImportPage/ConflictsContext';
import { SelectedEntityContext } from '@/entrypoints/ImportPage/SelectedEntityContext';
import { Schema } from '@/utils/icons';
import type { SchemaTypes } from '@datocms/cma-client';
import {
  Handle,
  type Node,
  type NodeProps,
  Position,
  type ReactFlowState,
  useStore,
} from '@xyflow/react';
import { useContext } from 'react';

export type PluginNode = Node<
  {
    plugin: SchemaTypes.Plugin;
  },
  'plugin'
>;

const zoomSelector = (s: ReactFlowState) => s.transform[2] >= 0.9;

export function PluginNodeRenderer({
  data: { plugin },
}: NodeProps<PluginNode>) {
  const entitiesToExport = useContext(EntitiesToExportContext);
  const conflicts = useContext(ConflictsContext);
  const selectedEntityContext = useContext(SelectedEntityContext);

  const conflictingEntity = conflicts?.plugins[plugin.id];

  const showDetails = useStore(zoomSelector);

  return (
    <>
      <Handle type="target" position={Position.Top} style={{ opacity: '0' }} />
      <div
        className={`
          app-node
          app-node--plugin
          ${conflictingEntity ? 'app-node--conflict' : ''}
          ${entitiesToExport && !entitiesToExport.pluginIds.includes(plugin.id) ? 'app-node__excluded-from-export' : ''}
          ${selectedEntityContext && selectedEntityContext.entity === plugin ? 'app-node__focused' : ''}
        `}
      >
        {showDetails && (
          <div className="app-node__type">
            <span className="app-node__icon">
              <Schema.PluginsIcon />
            </span>
            <span>Plugin</span>
          </div>
        )}
        <div className="app-node__body">
          <div className="app-node__name">{plugin.attributes.name}</div>
          {showDetails && (
            <div className="app-node__apikey">
              <code>v{plugin.attributes.package_version}</code>
            </div>
          )}
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ opacity: '0' }}
      />
    </>
  );
}
