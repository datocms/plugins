import type { NodeProps } from '@xyflow/react';
import { useContext } from 'react';
import {
  type ItemTypeNode,
  ItemTypeNodeRenderer,
} from '@/components/ItemTypeNodeRenderer';
import { EntitiesToExportContext } from '@/entrypoints/ExportPage/EntitiesToExportContext';

export function ExportItemTypeNodeRenderer(props: NodeProps<ItemTypeNode>) {
  const { itemType } = props.data;
  const entitiesToExport = useContext(EntitiesToExportContext);

  const excluded =
    entitiesToExport && !entitiesToExport.itemTypeIds.includes(itemType.id);

  return (
    <ItemTypeNodeRenderer
      {...props}
      name={itemType.attributes.name}
      apiKey={itemType.attributes.api_key}
      className={excluded ? 'app-node--excluded' : undefined}
    />
  );
}
