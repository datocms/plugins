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
import ApiKey from 'datocms-react-ui/ApiKey';
import Pill from 'datocms-react-ui/Pill';
import type { ReactNode } from 'react';
import { BlockIcon, ModelIcon } from '@/icons';
import s from './graph.module.css';

export type ItemTypeNode = Node<
  {
    itemType: SchemaTypes.ItemType;
    fields: SchemaTypes.Field[];
    fieldsets: SchemaTypes.Fieldset[];
  },
  'itemType'
>;

// Show extra metadata once the canvas is sufficiently zoomed in.
const zoomSelector = (state: ReactFlowState) => state.transform[2] >= 0.8;

/** Where a node shows its state pill */
export type StatusPlacement = 'top' | 'bottom';

/**
 * Node renderer used by React Flow to display a DatoCMS model/block, with the
 * kind and API key once zoomed in. The state pill shows at every zoom, on
 * the top border or on the bottom one. Its
 * fields show in its item of the overview, which a click on the node opens:
 * no card opens over the nodes next to it.
 */
export function ItemTypeNodeRenderer({
  data: { itemType },
  className,
  status,
  statusPlacement = 'top',
  name,
  apiKey,
}: NodeProps<ItemTypeNode> & {
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
  name: string;
  apiKey: string;
}) {
  const showDetails = useStore(zoomSelector);

  const isBlock = itemType.attributes.modular_block;
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
            {showDetails ? (
              <Pill icon={isBlock ? <BlockIcon /> : <ModelIcon />}>
                {isBlock ? 'Block' : 'Model'}
              </Pill>
            ) : null}
            {statusAbove}
          </span>
        ) : null}
        <div className={s.name}>{name}</div>
        {showDetails && (
          <div className={s.details}>
            <ApiKey>{apiKey}</ApiKey>
          </div>
        )}
        {statusBelow ? (
          <span className={classNames(s.pills, s.pillsBelow)}>{status}</span>
        ) : null}
      </div>
      <Handle type="source" position={Position.Right} className={s.handle} />
    </>
  );
}
