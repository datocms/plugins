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
import Pill from 'datocms-react-ui/Pill';
import type { ReactNode } from 'react';
import { PluginIcon } from '@/icons';
import s from './graph.module.css';

export type PluginNode = Node<
  {
    plugin: SchemaTypes.Plugin;
  },
  'plugin'
>;

// Show extra metadata once the canvas is sufficiently zoomed in.
const zoomSelector = (state: ReactFlowState) => state.transform[2] >= 0.8;

/**
 * Node renderer used by React Flow to display a plugin and, zoomed in, its
 * kind and version. The state pill shows at every zoom.
 */
export function PluginNodeRenderer({
  data: { plugin },
  className,
  status,
}: NodeProps<PluginNode> & {
  className?: string;
  /**
   * The word for the state that `className` paints (a Pill, as the overview
   * shows it): the paint alone does not tell it.
   */
  status?: ReactNode;
}) {
  const showDetails = useStore(zoomSelector);
  const version = plugin.attributes.package_version;

  return (
    <>
      <Handle type="target" position={Position.Top} className={s.handle} />
      <div className={classNames(s.node, className)}>
        {showDetails || status ? (
          <span className={s.pills}>
            {showDetails ? <Pill icon={<PluginIcon />}>Plugin</Pill> : null}
            {status}
          </span>
        ) : null}
        <div className={s.name}>{plugin.attributes.name}</div>
        {showDetails && version && (
          <div className={classNames(s.details, s.version)}>v{version}</div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className={s.handle} />
    </>
  );
}
