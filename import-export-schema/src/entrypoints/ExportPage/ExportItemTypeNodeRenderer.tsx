import type { NodeProps } from '@xyflow/react';
import classNames from 'classnames';
import Pill from 'datocms-react-ui/Pill';
import { useContext } from 'react';
import {
  type ItemTypeNode,
  ItemTypeNodeRenderer,
} from '@/components/ItemTypeNodeRenderer';
import { nodeState } from '@/components/nodeState';
import { SelectedEntityContext } from '@/components/SchemaOverview/SelectedEntityContext';
import { EntitiesToExportContext } from '@/entrypoints/ExportPage/EntitiesToExportContext';

/**
 * An item-type node of the export graph: faded, with a "Not included" pill,
 * when it is out of the export, in the selected colors when it is the
 * focused entity.
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
        excluded && nodeState.excluded,
        isFocused && nodeState.focused,
      )}
      status={excluded ? <Pill>Not included</Pill> : undefined}
    />
  );
}
