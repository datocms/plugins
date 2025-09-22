import { useId, useMemo, useState } from 'react';
import { TextField } from 'datocms-react-ui';
import {
  countCycles,
  getConnectedComponents,
  splitNodesByType,
} from '@/utils/graph/analysis';
import type { ItemTypeNode } from '@/components/ItemTypeNodeRenderer';
import type { PluginNode } from '@/components/PluginNodeRenderer';
import type { Graph } from '@/utils/graph/types';
import styles from './LargeSelectionLayout.module.css';

// Centralized UI shell for the "large selection" experiences so both import and export
// pages can share the same graph overview, search affordances, and layout framing.

export type LargeSelectionLayoutRenderArgs = {
  itemTypeNodes: ItemTypeNode[];
  pluginNodes: PluginNode[];
  filteredItemTypeNodes: ItemTypeNode[];
  filteredPluginNodes: PluginNode[];
  metrics: {
    itemTypeCount: number;
    pluginCount: number;
    edgeCount: number;
    components: number;
    cycles: number;
  };
};

type Props = {
  graph: Graph;
  searchLabel: string;
  searchPlaceholder: string;
  headerNotice?: React.ReactNode;
  renderContent: (args: LargeSelectionLayoutRenderArgs) => React.ReactNode;
  renderFooter?: (args: LargeSelectionLayoutRenderArgs) => React.ReactNode;
};

/**
 * Shared scaffold for the large-selection fallback used by both import and export flows.
 * Packages graph analytics, filtering, and chrome so each flow only supplies row renderers.
 */
export function LargeSelectionLayout({
  graph,
  searchLabel,
  searchPlaceholder,
  headerNotice,
  renderContent,
  renderFooter,
}: Props) {
  const searchInputId = useId();
  const [query, setQuery] = useState('');

  // Split the graph into the node buckets each flow expects to render while keeping the
  // original graph intact for metrics and dependency calculations.
  const { itemTypeNodes, pluginNodes } = useMemo(
    () => splitNodesByType(graph),
    [graph],
  );

  // Precompute graph-wide metrics so both import/export screens surface the same context
  // about model/plugin counts, connectivity, and potential cycle issues.
  const metrics = useMemo(() => {
    const components = getConnectedComponents(graph).length;
    const cycles = countCycles(graph);
    return {
      itemTypeCount: itemTypeNodes.length,
      pluginCount: pluginNodes.length,
      edgeCount: graph.edges.length,
      components,
      cycles,
    };
  }, [graph, itemTypeNodes.length, pluginNodes.length]);

  const filteredItemTypeNodes = useMemo(() => {
    if (!query) return itemTypeNodes;
    const lower = query.toLowerCase();
    return itemTypeNodes.filter((node) => {
      const { itemType } = node.data;
      return (
        itemType.attributes.name.toLowerCase().includes(lower) ||
        itemType.attributes.api_key.toLowerCase().includes(lower)
      );
    });
  }, [itemTypeNodes, query]);

  const filteredPluginNodes = useMemo(() => {
    if (!query) return pluginNodes;
    const lower = query.toLowerCase();
    return pluginNodes.filter((node) =>
      node.data.plugin.attributes.name.toLowerCase().includes(lower),
    );
  }, [pluginNodes, query]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.metrics}>
          {metrics.itemTypeCount} models • {metrics.pluginCount} plugins •{' '}
          {metrics.edgeCount} relations
        </div>
        <div className={styles.meta}>
          Components: {metrics.components} • Cycles: {metrics.cycles}
        </div>
        {headerNotice ? (
          <div className={styles.notice}>{headerNotice}</div>
        ) : null}
        <div className={styles.search}>
          <TextField
            id={searchInputId}
            name="large-selection-search"
            label={searchLabel}
            placeholder={searchPlaceholder}
            value={query}
            onChange={(val) => setQuery(val)}
            textInputProps={{ autoComplete: 'off' }}
          />
        </div>
      </div>
      <div className={styles.body}>
        <div className={styles.columns}>
          {renderContent({
            itemTypeNodes,
            pluginNodes,
            filteredItemTypeNodes,
            filteredPluginNodes,
            metrics,
          })}
        </div>
        {renderFooter
          ? (
              <div className={styles.footer}>
                {renderFooter({
                  itemTypeNodes,
                  pluginNodes,
                  filteredItemTypeNodes,
                  filteredPluginNodes,
                  metrics,
                })}
              </div>
            )
          : null}
      </div>
    </div>
  );
}
