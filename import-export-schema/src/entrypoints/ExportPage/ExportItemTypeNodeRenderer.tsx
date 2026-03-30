import type { NodeProps } from '@xyflow/react';
import classNames from 'classnames';
import { useContext } from 'react';
import {
  type ItemTypeNode,
  ItemTypeNodeRenderer,
} from '@/components/ItemTypeNodeRenderer';
import { SelectedEntityContext } from '@/components/SchemaOverview/SelectedEntityContext';
import { EntitiesToExportContext } from '@/entrypoints/ExportPage/EntitiesToExportContext';

/**
 * Highlights item-type nodes that fall outside the export selection.
 */
export function ExportItemTypeNodeRenderer(props: NodeProps<ItemTypeNode>) {
  const { itemType } = props.data;
  const entitiesToExport = useContext(EntitiesToExportContext);
  const selectedEntityContext = useContext(SelectedEntityContext);

  const excluded =
    entitiesToExport && !entitiesToExport.itemTypeIds.includes(itemType.id);
  const isFocused = selectedEntityContext.entity === itemType;

  return (
    <ItemTypeNodeRenderer
      {...props}
      name={itemType.attributes.name}
      apiKey={itemType.attributes.api_key}
      className={classNames(
        excluded && 'app-node--excluded',
        isFocused && 'app-node--focused',
      )}
    />
  );
}
