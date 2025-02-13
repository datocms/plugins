import { EntitiesToExportContext } from '@/entrypoints/ExportPage/EntitiesToExportContext';
import { ConflictsContext } from '@/entrypoints/ImportPage/ConflictsContext';
import { SelectedEntityContext } from '@/entrypoints/ImportPage/SelectedEntityContext';
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
import classNames from 'classnames';
import { get, sortBy } from 'lodash-es';
import { useContext, useState } from 'react';
import { useFormState } from 'react-final-form';
import { Field } from '../components/Field';

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

const zoomSelector = (s: ReactFlowState) => s.transform[2] >= 0.8;

export function ItemTypeNodeRenderer({
  data: { itemType, fields, fieldsets },
}: NodeProps<ItemTypeNode>) {
  const entitiesToExport = useContext(EntitiesToExportContext);
  const conflicts = useContext(ConflictsContext);
  const selectedEntityContext = useContext(SelectedEntityContext);
  const formState = conflicts ? useFormState() : undefined;

  const [isTooltipVisible, setTooltipVisible] = useState(false);

  const showDetails = useStore(zoomSelector);

  const unresolvedConflict =
    conflicts?.itemTypes[itemType.id] &&
    get(formState?.errors, `itemType-${itemType.id}`);

  const resolutionStrategyIsReuseExisting =
    get(formState?.values, `itemType-${itemType.id}.strategy`) ===
    'reuseExisting';

  const resolutionStrategyIsRename =
    get(formState?.values, `itemType-${itemType.id}.strategy`) === 'rename';

  const resolutionNewName =
    resolutionStrategyIsRename &&
    get(formState?.values, `itemType-${itemType.id}.name`);

  const resolutionNewApiKey =
    resolutionStrategyIsRename &&
    get(formState?.values, `itemType-${itemType.id}.apiKey`);

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
        className={classNames(
          'app-node',
          itemType.attributes.modular_block
            ? 'app-node--block'
            : 'app-node--model',
          unresolvedConflict ? 'app-node--conflict' : '',
          entitiesToExport &&
            !entitiesToExport.itemTypeIds.includes(itemType.id)
            ? 'app-node__excluded-from-export'
            : '',
          resolutionStrategyIsReuseExisting && 'app-node__excluded-from-export',
          selectedEntityContext && selectedEntityContext.entity === itemType
            ? 'app-node__focused'
            : '',
        )}
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
          <div className="app-node__name">
            {resolutionNewName || itemType.attributes.name}
          </div>
          {showDetails && (
            <div className="app-node__apikey">
              <code>{resolutionNewApiKey || itemType.attributes.api_key}</code>
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
