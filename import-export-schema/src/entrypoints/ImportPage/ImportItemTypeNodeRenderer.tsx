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
import { UnresolvedConflictsContext } from '@/entrypoints/ImportPage/ConflictsManager/ConflictsContext';
import { useResolutionStatusForItemType } from '@/entrypoints/ImportPage/ResolutionsForm';

/**
 * An item-type node of the import graph: with a "Conflict" pill while its row
 * in the overview says so (a name, an API key or an ID to decide about),
 * faded with a "Uses existing" pill when the import reuses the existing one,
 * in the selected colors when it is the focused entity. A rename shows the
 * new name and API key.
 */
export function ImportItemTypeNodeRenderer(props: NodeProps<ItemTypeNode>) {
  const { itemType } = props.data;

  const unresolvedConflict = useContext(
    UnresolvedConflictsContext,
  ).itemTypeIds.has(itemType.id);
  const selectedEntityContext = useContext(SelectedEntityContext);
  const resolution = useResolutionStatusForItemType(itemType.id);

  const resolutionStrategyIsReuseExisting =
    !unresolvedConflict && resolution?.values.strategy === 'reuseExisting';

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
        resolutionStrategyIsReuseExisting && nodeState.excluded,
        selectedEntityContext.entity === itemType && nodeState.focused,
      )}
      status={
        unresolvedConflict ? (
          <Pill tone="warning">Conflict</Pill>
        ) : resolutionStrategyIsReuseExisting ? (
          <Pill>Uses existing</Pill>
        ) : undefined
      }
    />
  );
}
