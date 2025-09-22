import type { ReactNode } from 'react';
import { findInboundEdges, findOutboundEdges } from '@/utils/graph/analysis';
import type { ItemTypeNode } from '@/components/ItemTypeNodeRenderer';
import type { PluginNode } from '@/components/PluginNodeRenderer';
import type { Graph } from '@/utils/graph/types';
import sharedStyles from './LargeSelectionColumns.module.css';

export type ItemTypeRowRenderArgs = {
  node: ItemTypeNode;
  inboundEdges: Graph['edges'];
  outboundEdges: Graph['edges'];
};

export type PluginRowRenderArgs = {
  node: PluginNode;
  inboundEdges: Graph['edges'];
};

export type LargeSelectionColumnsProps = {
  graph: Graph;
  filteredItemTypeNodes: ItemTypeNode[];
  filteredPluginNodes: PluginNode[];
  renderItemTypeRow: (args: ItemTypeRowRenderArgs) => ReactNode;
  renderPluginRow: (args: PluginRowRenderArgs) => ReactNode;
};

/**
 * Shared renderer for the list-based large-selection views. It gathers relationship
 * metrics and column scaffolding so individual variants only provide row content.
 */
export function LargeSelectionColumns({
  graph,
  filteredItemTypeNodes,
  filteredPluginNodes,
  renderItemTypeRow,
  renderPluginRow,
}: LargeSelectionColumnsProps) {
  return (
    <>
      <section className={`${sharedStyles.column} ${sharedStyles.modelsColumn}`}>
        <div className={sharedStyles.sectionTitle}>Models</div>
        <ul className={sharedStyles.list}>
          {filteredItemTypeNodes.map((node) => {
            const itemType = node.data.itemType;
            const inboundEdges = findInboundEdges(
              graph,
              `itemType--${itemType.id}`,
            );
            const outboundEdges = findOutboundEdges(
              graph,
              `itemType--${itemType.id}`,
            );
            return renderItemTypeRow({ node, inboundEdges, outboundEdges });
          })}
        </ul>
      </section>
      <section className={`${sharedStyles.column} ${sharedStyles.pluginsColumn}`}>
        <div className={sharedStyles.sectionTitle}>Plugins</div>
        <ul className={sharedStyles.list}>
          {filteredPluginNodes.map((node) => {
            const plugin = node.data.plugin;
            const inboundEdges = findInboundEdges(graph, `plugin--${plugin.id}`);
            return renderPluginRow({ node, inboundEdges });
          })}
        </ul>
      </section>
    </>
  );
}
