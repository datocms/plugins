import type { SchemaTypes } from '@datocms/cma-client';
import { Spinner, SwitchInput } from 'datocms-react-ui';
import { useMemo, useState } from 'react';
import classNames from 'classnames';
import Collapsible from '@/components/SchemaOverview/Collapsible';
import type { ItemTypeNode } from '@/components/ItemTypeNodeRenderer';
import type { PluginNode } from '@/components/PluginNodeRenderer';
import { getTextWithoutRepresentativeEmojiAndPadding } from '@/utils/emojiAgnosticSorter';
import type { Graph } from '@/utils/graph/types';

const localeAwareCollator = new Intl.Collator(undefined, {
  sensitivity: 'base',
  numeric: true,
});

type ItemTypeEntry = {
  itemType: SchemaTypes.ItemType;
  selected: boolean;
};

type PluginEntry = {
  plugin: SchemaTypes.Plugin;
  selected: boolean;
};

type ItemTypeBuckets = {
  selected: ItemTypeEntry[];
  unselected: ItemTypeEntry[];
};

type GroupedItemTypes = {
  models: ItemTypeBuckets;
  blocks: ItemTypeBuckets;
};

type PluginBuckets = {
  selected: PluginEntry[];
  unselected: PluginEntry[];
};

type Props = {
  graph?: Graph;
  selectedItemTypeIds: string[];
  selectedPluginIds: string[];
};

function sortEntriesByDisplayName<T>(entries: T[], getName: (entry: T) => string) {
  return [...entries].sort((a, b) =>
    localeAwareCollator.compare(getName(a), getName(b)),
  );
}

function isItemTypeNode(node: Graph['nodes'][number]): node is ItemTypeNode {
  return node.type === 'itemType';
}

function isPluginNode(node: Graph['nodes'][number]): node is PluginNode {
  return node.type === 'plugin';
}

function renderItemTypeEntry(entry: ItemTypeEntry) {
  const {
    itemType: {
      attributes: { name, modular_block: isBlock },
    },
  } = entry;

  const className = entry.selected
    ? 'schema-overview__item schema-overview__item--selected'
    : 'schema-overview__item schema-overview__item--unselected';

  return (
    <Collapsible
      key={entry.itemType.id}
      entity={entry.itemType}
      title={name}
      className={className}
    >
      <p style={{ margin: 0 }}>
        This {isBlock ? 'block model' : 'model'} is currently{' '}
        {entry.selected ? 'selected for export.' : 'not part of this export.'}
      </p>
      <p style={{ margin: '8px 0 0' }}>
        {entry.selected
          ? 'The exported schema JSON will include this '
          : 'Select it '} 
        {entry.selected ? '.' : ' from the graph to include it.'}
      </p>
    </Collapsible>
  );
}

function renderPluginEntry(entry: PluginEntry) {
  const {
    plugin: {
      attributes: { name },
    },
  } = entry;

  const className = entry.selected
    ? 'schema-overview__item schema-overview__item--selected'
    : 'schema-overview__item schema-overview__item--unselected';

  return (
    <Collapsible
      key={entry.plugin.id}
      entity={entry.plugin}
      title={name}
      className={className}
    >
      <p style={{ margin: 0 }}>
        <strong>{name}</strong>{' '}
        is {entry.selected ? 'selected for export.' : 'not selected yet.'}
      </p>
      <p style={{ margin: '8px 0 0' }}>
        {entry.selected
          ? 'The exported recipe will include this plugin entry.'
          : 'Choose this plugin in the dependency graph if it should be exported.'}
      </p>
    </Collapsible>
  );
}

function renderItemTypeGroup(
  title: string,
  entries: ItemTypeEntry[],
  keyPrefix: string,
) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="conflicts-manager__group" key={`${keyPrefix}-${title}`}>
      <div className="conflicts-manager__group__title">
        {title} ({entries.length})
      </div>
      <div className="conflicts-manager__group__content">
        {entries.map((entry) => renderItemTypeEntry(entry))}
      </div>
    </div>
  );
}

function renderPluginGroup(
  title: string,
  entries: PluginEntry[],
  keyPrefix: string,
) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="conflicts-manager__group" key={`${keyPrefix}-${title}`}>
      <div className="conflicts-manager__group__title">
        {title} ({entries.length})
      </div>
      <div className="conflicts-manager__group__content">
        {entries.map((entry) => renderPluginEntry(entry))}
      </div>
    </div>
  );
}

function SchemaOverviewCategory({
  title,
  groups,
  className,
}: {
  title: string;
  groups: Array<JSX.Element | null>;
  className?: string;
}) {
  const filteredGroups = groups.filter(
    (group): group is JSX.Element => Boolean(group),
  );
  if (filteredGroups.length === 0) {
    return null;
  }

  return (
    <div className={classNames('schema-overview__category', className)}>
      <div className="schema-overview__category__title">{title}</div>
      {filteredGroups}
    </div>
  );
}

export function ExportSchemaOverview({
  graph,
  selectedItemTypeIds,
  selectedPluginIds,
}: Props) {
  const [showOnlySelected, setShowOnlySelected] = useState(false);
  const groupedItemTypes = useMemo<GroupedItemTypes>(() => {
    const empty: GroupedItemTypes = {
      models: { selected: [], unselected: [] },
      blocks: { selected: [], unselected: [] },
    };

    if (!graph) {
      return empty;
    }

    const entries = graph.nodes.filter(isItemTypeNode).map((node) => ({
      itemType: node.data.itemType,
      selected: selectedItemTypeIds.includes(node.data.itemType.id),
    }));

    for (const entry of entries) {
      // TypeScript work-around to keep strong typing during population.
      const bucketRef = entry.itemType.attributes.modular_block
        ? empty.blocks
        : empty.models;

      if (entry.selected) {
        bucketRef.selected.push(entry);
      } else {
        bucketRef.unselected.push(entry);
      }
    }

    const sortItemTypes = (items: ItemTypeEntry[]) =>
      sortEntriesByDisplayName(items, (entry) =>
        getTextWithoutRepresentativeEmojiAndPadding(
          entry.itemType.attributes.name,
        ),
      );

    return {
      models: {
        selected: sortItemTypes(empty.models.selected),
        unselected: sortItemTypes(empty.models.unselected),
      },
      blocks: {
        selected: sortItemTypes(empty.blocks.selected),
        unselected: sortItemTypes(empty.blocks.unselected),
      },
    };
  }, [graph, selectedItemTypeIds]);

  const pluginBuckets = useMemo<PluginBuckets>(() => {
    const empty: PluginBuckets = { selected: [], unselected: [] };

    if (!graph) {
      return empty;
    }

    for (const node of graph.nodes.filter(isPluginNode)) {
      const entry: PluginEntry = {
        plugin: node.data.plugin,
        selected: selectedPluginIds.includes(node.data.plugin.id),
      };

      if (entry.selected) {
        empty.selected.push(entry);
      } else {
        empty.unselected.push(entry);
      }
    }

    const sortPlugins = (items: PluginEntry[]) =>
      sortEntriesByDisplayName(items, (entry) =>
        getTextWithoutRepresentativeEmojiAndPadding(
          entry.plugin.attributes.name,
        ),
      );

    return {
      selected: sortPlugins(empty.selected),
      unselected: sortPlugins(empty.unselected),
    };
  }, [graph, selectedPluginIds]);

  const selectedCount =
    groupedItemTypes.models.selected.length +
    groupedItemTypes.blocks.selected.length +
    pluginBuckets.selected.length;
  const unselectedCount =
    groupedItemTypes.models.unselected.length +
    groupedItemTypes.blocks.unselected.length +
    pluginBuckets.unselected.length;

  if (!graph) {
    return (
      <div className="page">
        <div className="conflicts-manager__actions">
          <div style={{ fontWeight: 700, fontSize: '16px' }}>Schema overview</div>
        </div>
        <div className="page__content">
          <div className="surface" style={{ padding: '24px', display: 'flex', justifyContent: 'center' }}>
            <Spinner size={24} />
          </div>
        </div>
      </div>
    );
  }

  const selectedGroups = [
    renderItemTypeGroup('Models', groupedItemTypes.models.selected, 'selected-models'),
    renderItemTypeGroup(
      'Block models',
      groupedItemTypes.blocks.selected,
      'selected-blocks',
    ),
    renderPluginGroup('Plugins', pluginBuckets.selected, 'selected-plugins'),
  ];

  const unselectedGroups = showOnlySelected
    ? []
    : [
        renderItemTypeGroup(
          'Models',
          groupedItemTypes.models.unselected,
          'unselected-models',
        ),
        renderItemTypeGroup(
          'Block models',
          groupedItemTypes.blocks.unselected,
          'unselected-blocks',
        ),
        renderPluginGroup('Plugins', pluginBuckets.unselected, 'unselected-plugins'),
      ];

  return (
    <div className="page">
      <div className="conflicts-manager__actions">
        <div style={{ fontWeight: 700, fontSize: '16px' }}>Schema overview</div>
        <div className="schema-overview__summary">
          <span>{selectedCount} selected</span>
          <span aria-hidden="true">•</span>
          <span>{unselectedCount} not selected</span>
        </div>
      </div>
      <div className="conflicts-manager__actions" style={{ paddingTop: 0 }}>
        <label
          htmlFor="schema-overview-only-selected"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            marginTop: '10px',
            fontSize: '12px',
            color: 'var(--light-body-color)',
            cursor: 'pointer',
          }}
        >
          <SwitchInput
            id="schema-overview-only-selected"
            name="schema-overview-only-selected"
            value={showOnlySelected}
            onChange={(nextValue) => setShowOnlySelected(nextValue)}
            aria-label="Show only selected exports"
          />
          <span>Show only selected exports</span>
        </label>
      </div>
      <div className="page__content">
        {selectedCount === 0 && unselectedCount === 0 ? (
          <div className="surface" style={{ padding: '24px' }}>
            <p style={{ margin: 0 }}>
              Nothing to show yet — pick a model or plugin to build the export
              graph.
            </p>
          </div>
        ) : null}

        <SchemaOverviewCategory
          title="Selected exports"
          className="schema-overview__category--selected"
          groups={selectedGroups}
        />
        <SchemaOverviewCategory
          title="Unselected exports"
          groups={unselectedGroups}
        />
      </div>
    </div>
  );
}
