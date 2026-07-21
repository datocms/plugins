import type { ModelSummary, RawItemType } from '../types';

type ItemTypeCollection =
  | Readonly<Record<string, RawItemType | undefined>>
  | readonly RawItemType[];

export function mapItemTypeToModelSummary(itemType: RawItemType): ModelSummary {
  return {
    id: itemType.id,
    name: itemType.attributes.name,
    apiKey: itemType.attributes.api_key,
    draftModeActive: itemType.attributes.draft_mode_active,
    workflowId: itemType.relationships.workflow.data?.id ?? null,
  };
}

export function getRegularModels(
  itemTypes: ItemTypeCollection,
): ModelSummary[] {
  const values = Array.isArray(itemTypes)
    ? itemTypes
    : Object.values(itemTypes);

  return values
    .filter(
      (itemType): itemType is RawItemType =>
        Boolean(itemType) && !itemType.attributes.modular_block,
    )
    .map(mapItemTypeToModelSummary)
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name, undefined, {
          sensitivity: 'base',
        }) || left.id.localeCompare(right.id),
    );
}
