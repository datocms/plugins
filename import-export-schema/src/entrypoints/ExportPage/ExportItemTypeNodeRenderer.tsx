import {
  type ItemTypeNode,
  ItemTypeNodeRenderer,
} from '@/components/ItemTypeNodeRenderer';
import { EntitiesToExportContext } from '@/entrypoints/ExportPage/EntitiesToExportContext';
import type { NodeProps } from '@xyflow/react';
import { useContext } from 'react';

export function ExportItemTypeNodeRenderer(props: NodeProps<ItemTypeNode>) {
  const { itemType } = props.data;
  const entitiesToExport = useContext(EntitiesToExportContext);

  return (
    <ItemTypeNodeRenderer
      {...props}
      name={itemType.attributes.name}
      apiKey={itemType.attributes.api_key}
      className={
        entitiesToExport && !entitiesToExport.itemTypeIds.includes(itemType.id)
          ? 'app-node__excluded-from-export'
          : undefined
      }
    />
  );
}
