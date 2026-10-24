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
import HoverCard from 'datocms-react-ui/HoverCard';
import Pill from 'datocms-react-ui/Pill';
import type { ReactNode } from 'react';
import { BlockIcon, ModelIcon } from '@/icons';
import { FieldList } from './FieldList';
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
 * Node renderer used by React Flow to display a DatoCMS model/block, with its
 * fields and fieldsets in a hover card, and the kind and API key once zoomed
 * in. The overview lists the same fields without a pointer. The state pill
 * shows at every zoom.
 */
export function ItemTypeNodeRenderer({
  data: { itemType, fields, fieldsets },
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
      <Handle type="target" position={Position.Top} className={s.handle} />
      <HoverCard
        placement="right"
        content={
          <HoverCard.Body>
            <FieldList fields={fields} fieldsets={fieldsets} />
          </HoverCard.Body>
        }
      >
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
      </HoverCard>
      <Handle type="source" position={Position.Bottom} className={s.handle} />
    </>
  );
}
