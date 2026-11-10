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
import type { StatusPlacement } from './ItemTypeNodeRenderer';

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
 * kind and version. The state pill shows at every zoom, on the top border or
 * on the bottom one.
 */
export function PluginNodeRenderer({
  data: { plugin },
  className,
  status,
  statusPlacement = 'top',
}: NodeProps<PluginNode> & {
  className?: string;
  /**
   * The word for the state that `className` paints (a Pill, as the overview
   * shows it): the paint alone does not tell it.
   */
  status?: ReactNode;
  /**
   * Where the state pill goes: next to the kind pill on the top border, or
   * alone on the bottom border, where a longer word fits
   */
  statusPlacement?: StatusPlacement;
}) {
  const showDetails = useStore(zoomSelector);
  const version = plugin.attributes.package_version;
  const statusBelow = statusPlacement === 'bottom' && Boolean(status);
  const statusAbove = statusBelow ? null : status;

  return (
    <>
      <Handle type="target" position={Position.Left} className={s.handle} />
      <div
        className={classNames(
          s.node,
          statusBelow && s.withStatusBelow,
          className,
        )}
      >
        {showDetails || statusAbove ? (
          <span className={s.pills}>
            {showDetails ? <Pill icon={<PluginIcon />}>Plugin</Pill> : null}
            {statusAbove}
          </span>
        ) : null}
        <div className={s.name}>{plugin.attributes.name}</div>
        {showDetails && version && (
          <div className={classNames(s.details, s.version)}>v{version}</div>
        )}
        {statusBelow ? (
          <span className={classNames(s.pills, s.pillsBelow)}>{status}</span>
        ) : null}
      </div>
      <Handle type="source" position={Position.Right} className={s.handle} />
    </>
  );
}
