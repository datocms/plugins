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

/**
 * Node renderer used by React Flow to display a DatoCMS model/block, with the
 * kind and API key once zoomed in. The state pill shows at every zoom. Its
 * fields show in its item of the overview, which a click on the node opens:
 * no card opens over the nodes next to it.
 */
export function ItemTypeNodeRenderer({
  data: { itemType },
  className,
  status,
  name,
  apiKey,
}: NodeProps<ItemTypeNode> & {
  className?: string;
  /**
   * The word for the state that `className` paints (a Pill, as the overview
   * shows it): the paint alone does not tell it.
   */
  status?: ReactNode;
  name: string;
  apiKey: string;
}) {
  const showDetails = useStore(zoomSelector);

  const isBlock = itemType.attributes.modular_block;

  return (
    <>
      <Handle type="target" position={Position.Left} className={s.handle} />
      <div className={classNames(s.node, className)}>
        {showDetails || status ? (
          <span className={s.pills}>
            {showDetails ? (
              <Pill icon={isBlock ? <BlockIcon /> : <ModelIcon />}>
                {isBlock ? 'Block' : 'Model'}
              </Pill>
            ) : null}
            {status}
          </span>
        ) : null}
        <div className={s.name}>{name}</div>
        {showDetails && (
          <div className={s.details}>
            <ApiKey>{apiKey}</ApiKey>
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} className={s.handle} />
    </>
  );
}
