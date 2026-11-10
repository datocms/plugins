import type { NodeProps } from '@xyflow/react';
import classNames from 'classnames';
import { useContext } from 'react';
import {
  type ItemTypeNode,
  ItemTypeNodeRenderer,
} from '@/components/ItemTypeNodeRenderer';
import { nodeState } from '@/components/nodeState';
import { SelectedEntityContext } from '@/components/SchemaOverview/SelectedEntityContext';
import { EntitiesToExportContext } from '@/entrypoints/ExportPage/EntitiesToExportContext';
import { ExportStatePill } from './ExportStatePill';
import { itemTypeExportState } from './exportState';

/**
 * An item-type node of the export graph: tinted with a checked pill when it
 * is in the file ("Starting point", "Included", "Included as dependency"),
 * dashed and muted with a "Not exported" pill when it is not, with a ring
 * when it is the focused entity.
 */
export function ExportItemTypeNodeRenderer(props: NodeProps<ItemTypeNode>) {
  const { itemType } = props.data;
  const selection = useContext(EntitiesToExportContext);
  const selectedEntityContext = useContext(SelectedEntityContext);

  const state = selection
    ? itemTypeExportState(selection, itemType.id)
    : undefined;
  const isFocused = selectedEntityContext.entity === itemType;

  return (
    <ItemTypeNodeRenderer
      {...props}
      name={itemType.attributes.name}
      apiKey={itemType.attributes.api_key}
      className={classNames(
        state === 'excluded' && nodeState.excluded,
        state && state !== 'excluded' && nodeState.included,
        isFocused && nodeState.current,
      )}
      status={state ? <ExportStatePill state={state} /> : undefined}
      statusPlacement="bottom"
    />
  );
}
