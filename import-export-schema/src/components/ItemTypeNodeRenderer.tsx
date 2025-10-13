import type { SchemaTypes } from '@datocms/cma-client';
import {
  Handle,
  type Node,
  type NodeProps,
  NodeToolbar,
  Position,
  type ReactFlowState,
  useStore,
} from '@xyflow/react';
import classNames from 'classnames';
import sortBy from 'lodash-es/sortBy';
import { useState } from 'react';
import { Schema } from '@/utils/icons';
import { Field } from '../components/Field';

export type ItemTypeNode = Node<
  {
    itemType: SchemaTypes.ItemType;
    fields: SchemaTypes.Field[];
    fieldsets: SchemaTypes.Fieldset[];
  },
  'itemType'
>;

/**
 * Renders a fieldset summary inside the item-type tooltip, keeping field ordering in sync
 * with their schema positions.
 */
function Fieldset({
  fieldset,
  allFields,
}: {
  fieldset: SchemaTypes.Fieldset;
  allFields: SchemaTypes.Field[];
}) {
  return (
    <div className="fieldset">
      <div className="fieldset__title">{fieldset.attributes.title}</div>
      <div className="fieldset__fields">
        {sortBy(
          allFields.filter(
            (f) => f.relationships.fieldset.data?.id === fieldset.id,
          ),
          'attributes.position',
        ).map((field: SchemaTypes.Field) => (
          <Field key={field.id} field={field} />
        ))}
      </div>
    </div>
  );
}

// Show extra metadata once the canvas is sufficiently zoomed in.
const zoomSelector = (s: ReactFlowState) => s.transform[2] >= 0.8;

/**
 * Node renderer used by React Flow to display a DatoCMS model/block with a hoverable
 * field list and API key details that show when zoomed in.
 */
export function ItemTypeNodeRenderer({
  data: { itemType, fields, fieldsets },
  className,
  name,
  apiKey,
}: NodeProps<ItemTypeNode> & {
  className?: string;
  name: string;
  apiKey: string;
}) {
  const [isTooltipVisible, setTooltipVisible] = useState(false);

  const showDetails = useStore(zoomSelector);

  const TypeIconComponent = itemType.attributes.modular_block
    ? Schema.BlocksIcon
    : Schema.ModelsIcon;

  return (
    <>
      <Handle type="target" position={Position.Top} style={{ opacity: '0' }} />
      <NodeToolbar
        position={Position.Right}
        isVisible={isTooltipVisible}
        className="tooltip"
      >
        {fields.length + fieldsets.length === 0
          ? 'No fields'
          : sortBy(
              [
                ...fields.filter((e) => !e.relationships.fieldset.data),
                ...fieldsets,
              ],
              'attributes.position',
            ).map(
              (fieldOrFieldset: SchemaTypes.Field | SchemaTypes.Fieldset) =>
                fieldOrFieldset.type === 'field' ? (
                  <Field key={fieldOrFieldset.id} field={fieldOrFieldset} />
                ) : (
                  <Fieldset
                    key={fieldOrFieldset.id}
                    fieldset={fieldOrFieldset}
                    allFields={fields}
                  />
                ),
            )}
      </NodeToolbar>
      <div
        className={classNames(
          'app-node',
          itemType.attributes.modular_block
            ? 'app-node--block'
            : 'app-node--model',
          className,
        )}
        role="group"
        onMouseEnter={() => setTooltipVisible(true)}
        onMouseLeave={() => setTooltipVisible(false)}
      >
        {showDetails && (
          <div className="app-node__type">
            <span className="app-node__icon">
              <TypeIconComponent />
            </span>
            <span>{itemType.attributes.modular_block ? 'Block' : 'Model'}</span>
          </div>
        )}
        <div className="app-node__body">
          <div className="app-node__name">{name}</div>
          {showDetails && (
            <div className="app-node__apikey">
              <code>{apiKey}</code>
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
