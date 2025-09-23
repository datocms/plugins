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
import classNames from 'classnames';

export type PluginNode = Node<
  {
    plugin: SchemaTypes.Plugin;
  },
  'plugin'
>;

const zoomSelector = (s: ReactFlowState) => s.transform[2] >= 0.8;

export function PluginNodeRenderer({
  data: { plugin },
  className,
}: NodeProps<PluginNode> & { className?: string }) {
  const showDetails = useStore(zoomSelector);

  return (
    <>
      <Handle type="target" position={Position.Top} style={{ opacity: '0' }} />
      <div className={classNames('app-node', 'app-node--plugin', className)}>
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
