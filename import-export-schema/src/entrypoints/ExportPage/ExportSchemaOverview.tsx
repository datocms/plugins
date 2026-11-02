/**
 * The overview pane of the export graph: the models, blocks and plugins of
 * the graph, grouped by kind, with what goes in the export first. Opening
 * an item focuses its node; its switch adds it to the export or removes it,
 * as a click on the node does.
 */
import type { SchemaTypes } from '@datocms/cma-client';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import ListArea from 'datocms-react-ui/ListArea';
import Pane, { type ListPreset, useFilteredList } from 'datocms-react-ui/Pane';
import Pill from 'datocms-react-ui/Pill';
import SwitchInput from 'datocms-react-ui/SwitchInput';
import { memo, useMemo, useState } from 'react';
import { FieldList } from '@/components/FieldList';
import type { ItemTypeNode } from '@/components/ItemTypeNodeRenderer';
import type { PluginNode } from '@/components/PluginNodeRenderer';
import { OverviewGroup } from '@/components/SchemaOverview/OverviewGroup';
import {
  type OverviewEntity,
  OverviewItem,
  type OverviewKind,
} from '@/components/SchemaOverview/OverviewItem';
import { useFormatters } from '@/texts';
import { getTextWithoutRepresentativeEmojiAndPadding } from '@/utils/emojiAgnosticSorter';
import type { Graph } from '@/utils/graph/types';

const localeAwareCollator = new Intl.Collator(undefined, {
  sensitivity: 'base',
  numeric: true,
});

type ItemTypeEntry = {
  kind: 'model' | 'block';
  entity: SchemaTypes.ItemType;
  fields: SchemaTypes.Field[];
  fieldsets: SchemaTypes.Fieldset[];
  /** It goes in the export */
  selected: boolean;
  /** Its place in the lists: see `useListOrder` */
  listedAsSelected: boolean;
};

type PluginEntry = {
  kind: 'plugin';
  entity: SchemaTypes.Plugin;
  selected: boolean;
  listedAsSelected: boolean;
};

type OverviewEntry = ItemTypeEntry | PluginEntry;

const kindOrder: OverviewKind[] = ['model', 'block', 'plugin'];

const notIncludedPresetId = 'unselected';

const presetOptions: ListPreset<OverviewEntry>[] = [
  {
    id: 'selected',
    label: 'Included',
    shortLabel: 'Included',
    matches: (entry) => entry.listedAsSelected,
  },
  {
    id: notIncludedPresetId,
    label: 'Not included',
    shortLabel: 'Not included',
    matches: (entry) => !entry.listedAsSelected,
  },
];

type ListOptions = {
  /** The graph to list: none while it loads, or when it could not be built */
  graph: Graph | undefined;
  /** The open item of the overview, which freezes the order of the lists */
  focusedEntity: OverviewEntity | undefined;
  selectedItemTypeIds: string[];
  selectedPluginIds: string[];
};

type Props = {
  /**
   * The graph to list: none while it builds or after it failed, when the
   * graph pane next to it tells so alone
   */
  graph?: Graph;
  /** The entries, the filter and the presets: see `useExportOverviewList` */
  list: ExportOverviewList;
  /** The item types the export starts from: always included */
  initialItemTypeIds: string[];
  onToggleItemType: (itemTypeId: string) => void;
  onTogglePlugin: (pluginId: string) => void;
};

function isItemTypeNode(node: Graph['nodes'][number]): node is ItemTypeNode {
  return node.type === 'itemType';
}

function isPluginNode(node: Graph['nodes'][number]): node is PluginNode {
  return node.type === 'plugin';
}

function sortName(entry: OverviewEntry) {
  return getTextWithoutRepresentativeEmojiAndPadding(
    entry.entity.attributes.name,
  );
}

function getEntryId(entry: OverviewEntry) {
  return entry.entity.id;
}

function getEntrySearchTexts(entry: OverviewEntry) {
  return [
    entry.entity.attributes.name,
    entry.kind === 'plugin'
      ? entry.entity.attributes.package_name
      : entry.entity.attributes.api_key,
  ];
}

/**
 * The selection that orders the lists. While an item is open, the lists keep
 * the order they had when it opened: its switch then changes the export
 * without moving the item away from under the pointer. The order follows the
 * selection again when the item closes, or when another item opens.
 */
function useListOrder(
  focused: OverviewEntity | undefined,
  selectedItemTypeIds: string[],
  selectedPluginIds: string[],
) {
  const [frozen, setFrozen] = useState<{
    entity: OverviewEntity;
    itemTypeIds: string[];
    pluginIds: string[];
  } | null>(null);

  if (focused && frozen?.entity !== focused) {
    setFrozen({
      entity: focused,
      itemTypeIds: selectedItemTypeIds,
      pluginIds: selectedPluginIds,
    });
  } else if (!focused && frozen) {
    setFrozen(null);
  }

  return focused && frozen?.entity === focused
    ? frozen
    : { itemTypeIds: selectedItemTypeIds, pluginIds: selectedPluginIds };
}

/**
 * The entries of the overview, with its text filter and its presets. The
 * graph screen keeps them, because the split unmounts a closed overview: the
 * filter and the preset then survive a close.
 */
export function useExportOverviewList({
  graph,
  focusedEntity,
  selectedItemTypeIds,
  selectedPluginIds,
}: ListOptions) {
  const { itemTypeIds: listedItemTypeIds, pluginIds: listedPluginIds } =
    useListOrder(focusedEntity, selectedItemTypeIds, selectedPluginIds);

  const entries = useMemo<OverviewEntry[]>(() => {
    if (!graph) {
      return [];
    }

    const selectedItemTypes = new Set(selectedItemTypeIds);
    const selectedPlugins = new Set(selectedPluginIds);
    const listedItemTypes = new Set(listedItemTypeIds);
    const listedPlugins = new Set(listedPluginIds);

    const itemTypeEntries = graph.nodes.filter(isItemTypeNode).map(
      ({ data: { itemType, fields, fieldsets } }): ItemTypeEntry => ({
        kind: itemType.attributes.modular_block ? 'block' : 'model',
        entity: itemType,
        fields,
        fieldsets,
        selected: selectedItemTypes.has(itemType.id),
        listedAsSelected: listedItemTypes.has(itemType.id),
      }),
    );

    const pluginEntries = graph.nodes.filter(isPluginNode).map(
      ({ data: { plugin } }): PluginEntry => ({
        kind: 'plugin',
        entity: plugin,
        selected: selectedPlugins.has(plugin.id),
        listedAsSelected: listedPlugins.has(plugin.id),
      }),
    );

    // What goes in the export first, then by name, ignoring a leading emoji
    const all: OverviewEntry[] = [...itemTypeEntries, ...pluginEntries];
    return all.sort(
      (a, b) =>
        Number(b.listedAsSelected) - Number(a.listedAsSelected) ||
        localeAwareCollator.compare(sortName(a), sortName(b)),
    );
  }, [
    graph,
    selectedItemTypeIds,
    selectedPluginIds,
    listedItemTypeIds,
    listedPluginIds,
  ]);

  return useFilteredList(entries, getEntrySearchTexts, presetOptions);
}

export type ExportOverviewList = ReturnType<typeof useExportOverviewList>;

export function ExportSchemaOverview({
  graph,
  list,
  initialItemTypeIds,
  onToggleItemType,
  onTogglePlugin,
}: Props) {
  const format = useFormatters();
  const { filter, presets, filteredItems, hasNoResults } = list;

  const groups = useMemo(
    () =>
      kindOrder
        .map((kind) => ({
          kind,
          entries: filteredItems.filter((entry) => entry.kind === kind),
        }))
        .filter((group) => group.entries.length > 0),
    [filteredItems],
  );

  const initialIds = useMemo(
    () => new Set(initialItemTypeIds),
    [initialItemTypeIds],
  );
  const inNotIncludedView = presets?.value === notIncludedPresetId;

  return (
    <Pane
      ariaLabel="Schema overview"
      header={
        <Pane.Header filter={graph ? filter : undefined}>
          <Pane.Header.Title presets={graph ? presets : undefined}>
            Schema overview
          </Pane.Header.Title>
          {graph ? (
            <Pane.Header.Subtitle>
              {format.count(filteredItems.length, 'item', 'items')}
            </Pane.Header.Subtitle>
          ) : null}
        </Pane.Header>
      }
    >
      {!graph ? null : hasNoResults ? (
        <Pane.FilterBlankSlate />
      ) : (
        <ListArea>
          {groups.map((group) => (
            <OverviewGroup
              key={group.kind}
              kind={group.kind}
              entries={group.entries}
              getEntityId={getEntryId}
              onlyGroup={groups.length === 1}
            >
              {(entry) => (
                <ExportOverviewItem
                  key={entry.entity.id}
                  entry={entry}
                  isInitial={
                    entry.kind !== 'plugin' && initialIds.has(entry.entity.id)
                  }
                  inNotIncludedView={inNotIncludedView}
                  onToggleItemType={onToggleItemType}
                  onTogglePlugin={onTogglePlugin}
                />
              )}
            </OverviewGroup>
          ))}
        </ListArea>
      )}
    </Pane>
  );
}

type ItemProps = {
  entry: OverviewEntry;
  isInitial: boolean;
  /**
   * The list shows only what is not included, as its title says: the row
   * then needs no "Not included" pill
   */
  inNotIncludedView: boolean;
  onToggleItemType: (itemTypeId: string) => void;
  onTogglePlugin: (pluginId: string) => void;
};

/**
 * An element of the overview. The body is the keyboard way to do what a click
 * on the node does: add the element to the export or remove it.
 */
const ExportOverviewItem = memo(function ExportOverviewItem({
  entry,
  isInitial,
  inNotIncludedView,
  onToggleItemType,
  onTogglePlugin,
}: ItemProps) {
  const toggle = () => {
    if (entry.kind === 'plugin') {
      onTogglePlugin(entry.entity.id);
    } else {
      onToggleItemType(entry.entity.id);
    }
  };

  const status = isInitial ? (
    <Pill>Starting point</Pill>
  ) : entry.selected || inNotIncludedView ? null : (
    <Pill>Not included</Pill>
  );

  return (
    <OverviewItem entity={entry.entity} status={status}>
      <FieldWrapper>
        <SwitchInput
          label="Included in the export"
          value={isInitial || entry.selected}
          onChange={toggle}
          forcedOn={
            isInitial
              ? {
                  reason:
                    entry.kind === 'block'
                      ? 'The export starts from this block.'
                      : 'The export starts from this model.',
                }
              : undefined
          }
        />
      </FieldWrapper>
      {entry.kind === 'plugin' ? null : (
        <FieldList fields={entry.fields} fieldsets={entry.fieldsets} />
      )}
    </OverviewItem>
  );
});
