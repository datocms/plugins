import type { NodeProps } from '@xyflow/react';
import classNames from 'classnames';
import { useContext } from 'react';
import {
  type ItemTypeNode,
  ItemTypeNodeRenderer,
} from '@/components/ItemTypeNodeRenderer';
import { ConflictsContext } from '@/entrypoints/ImportPage/ConflictsManager/ConflictsContext';
import { useResolutionStatusForItemType } from '@/entrypoints/ImportPage/ResolutionsForm';
import { SelectedEntityContext } from '@/entrypoints/ImportPage/SelectedEntityContext';

export function ImportItemTypeNodeRenderer(props: NodeProps<ItemTypeNode>) {
  const { itemType } = props.data;

  const conflict = useContext(ConflictsContext).itemTypes[itemType.id];
  const selectedEntityContext = useContext(SelectedEntityContext);
  const resolution = useResolutionStatusForItemType(itemType.id);

  const unresolvedConflict = conflict && resolution?.invalid;

  const resolutionStrategyIsReuseExisting =
    resolution?.values.strategy === 'reuseExisting';

  const resolutionStrategyIsRename = resolution?.values.strategy === 'rename';

  const resolutionNewName =
    resolutionStrategyIsRename && resolution?.values.name;

  const resolutionNewApiKey =
    resolutionStrategyIsRename && resolution?.values.apiKey;

  return (
    <ItemTypeNodeRenderer
      {...props}
      name={resolutionNewName || itemType.attributes.name}
      apiKey={resolutionNewApiKey || itemType.attributes.api_key}
      className={classNames(
        unresolvedConflict && 'app-node--conflict',
        resolutionStrategyIsReuseExisting && 'app-node--excluded',
        selectedEntityContext.entity === itemType && 'app-node--focused',
      )}
    />
  );
}
