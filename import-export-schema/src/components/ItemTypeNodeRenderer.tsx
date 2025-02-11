import { Schema } from '@/utils/icons';
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
import { sortBy } from 'lodash-es';
import { useContext, useState } from 'react';
import { Field } from '../components/Field';
import { SelectedEntitiesContext } from '../entrypoints/ExportModal/SelectedEntitiesContext';

export type ItemTypeNode = Node<
  {
    itemType: SchemaTypes.ItemType;
    fields: SchemaTypes.Field[];
    fieldsets: SchemaTypes.Fieldset[];
  },
  'itemType'
>;

function Fieldset({
  fieldset,
  allFields,
}: { fieldset: SchemaTypes.Fieldset; allFields: SchemaTypes.Field[] }) {
  return (
    <div className="fieldset">
      <div className="fieldset__title">{fieldset.attributes.title}</div>
      <div className="fieldset__fields">
        {sortBy(
          allFields.filter(
            (f) => f.relationships.fieldset.data?.id === fieldset.id,
          ),
          'attributes.position',
        ).map((field) => (
          <Field key={field.id} field={field} />
        ))}
      </div>
    </div>
  );
}

const zoomSelector = (s: ReactFlowState) => s.transform[2] >= 0.9;

export function ItemTypeNodeRenderer({
  data: { itemType, fields, fieldsets },
}: NodeProps<ItemTypeNode>) {
  const [isTooltipVisible, setTooltipVisible] = useState(false);
  const selectedEntities = useContext(SelectedEntitiesContext);
  const selected = selectedEntities
    ? selectedEntities.itemTypeIds.includes(itemType.id)
    : true;
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
        {fields.length + fieldsets.length === 0 ? (
          <>No fields</>
        ) : (
          sortBy(
            [
              ...fields.filter((e) => !e.relationships.fieldset.data),
              ...fieldsets,
            ],
            'attributes.position',
          ).map((fieldOrFieldset) =>
            fieldOrFieldset.type === 'field' ? (
              <Field key={fieldOrFieldset.id} field={fieldOrFieldset} />
            ) : (
              <Fieldset
                key={fieldOrFieldset.id}
                fieldset={fieldOrFieldset}
                allFields={fields}
              />
            ),
          )
        )}
      </NodeToolbar>
      <div
        className={`app-node ${itemType.attributes.modular_block ? 'app-node--block' : 'app-node--model'} ${selected ? 'is-selected' : 'is-not-selected'}`}
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
          <div className="app-node__name">{itemType.attributes.name}</div>
          {showDetails && (
            <div className="app-node__apikey">
              <code>{itemType.attributes.api_key}</code>
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
