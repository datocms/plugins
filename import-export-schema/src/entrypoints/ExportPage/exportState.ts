import { MarkerType } from '@xyflow/react';
import type { FieldEdgeExportState } from '@/components/FieldEdgeRenderer';
import type { Formatters } from '@/texts';
import type { AppEdge, AppNode } from '@/utils/graph/types';

/**
 * What the export does with a model, a block or a plugin of the graph:
 * - `start`: the export starts from it, thus it is always in the file
 * - `picked`: the user added it (a click on its node or its switch)
 * - `dependency`: "Add what it uses" added it
 * - `excluded`: it is not in the file
 */
export type ExportState = 'start' | 'picked' | 'dependency' | 'excluded';

/** The selection of the export, as the graph and the overview read it */
export type ExportSelection = {
  /** The item types the export starts from: always in the file */
  initialItemTypeIds: ReadonlySet<string>;
  /** The item types in the file, the initial ones included */
  itemTypeIds: ReadonlySet<string>;
  /** The plugins in the file */
  pluginIds: ReadonlySet<string>;
  /** The item types that "Add what it uses" added */
  dependencyItemTypeIds: ReadonlySet<string>;
  /** The plugins that "Add what it uses" added */
  dependencyPluginIds: ReadonlySet<string>;
};

/** The word of each state, on the nodes and in the overview */
export const exportStateLabels: Record<ExportState, string> = {
  start: 'Starting point',
  picked: 'Included',
  dependency: 'Included as dependency',
  excluded: 'Not exported',
};

export function itemTypeExportState(
  selection: ExportSelection,
  itemTypeId: string,
): ExportState {
  if (selection.initialItemTypeIds.has(itemTypeId)) return 'start';
  if (!selection.itemTypeIds.has(itemTypeId)) return 'excluded';
  return selection.dependencyItemTypeIds.has(itemTypeId)
    ? 'dependency'
    : 'picked';
}

export function pluginExportState(
  selection: ExportSelection,
  pluginId: string,
): ExportState {
  if (!selection.pluginIds.has(pluginId)) return 'excluded';
  return selection.dependencyPluginIds.has(pluginId) ? 'dependency' : 'picked';
}

export function nodeExportState(
  selection: ExportSelection,
  node: AppNode,
): ExportState {
  return node.type === 'plugin'
    ? pluginExportState(selection, node.data.plugin.id)
    : itemTypeExportState(selection, node.data.itemType.id);
}

/**
 * The edges of the graph with what the export does with each link: kept
 * when both ends are in the file, dropped when only its source is (the
 * fields lose the link), out of the file when its source is. A kept link
 * draws its arrowhead in the color of its line.
 */
export function edgesWithExportState(
  nodes: AppNode[],
  edges: AppEdge[],
  selection: ExportSelection,
): AppEdge[] {
  const exported = new Map(
    nodes.map((node) => [
      node.id,
      nodeExportState(selection, node) !== 'excluded',
    ]),
  );

  return edges.map((edge) => {
    const exportState: FieldEdgeExportState = !exported.get(edge.source)
      ? 'excluded'
      : exported.get(edge.target)
        ? 'included'
        : 'linkDropped';

    return {
      ...edge,
      data: { fields: edge.data?.fields ?? [], exportState },
      markerEnd:
        exportState === 'included'
          ? { type: MarkerType.ArrowClosed, color: 'var(--color--ink-primary)' }
          : edge.markerEnd,
    };
  });
}

export type ExportSummary = {
  models: number;
  blocks: number;
  plugins: number;
  /** The models, blocks and plugins of the graph left out of the file */
  notExported: number;
};

/** What the file holds, by kind, and what the graph leaves out of it */
export function summarizeExport(
  nodes: AppNode[],
  selection: ExportSelection,
): ExportSummary {
  const summary: ExportSummary = {
    models: 0,
    blocks: 0,
    plugins: 0,
    notExported: 0,
  };

  for (const node of nodes) {
    if (nodeExportState(selection, node) === 'excluded') {
      summary.notExported += 1;
    } else if (node.type === 'plugin') {
      summary.plugins += 1;
    } else if (node.data.itemType.attributes.modular_block) {
      summary.blocks += 1;
    } else {
      summary.models += 1;
    }
  }

  return summary;
}

/**
 * The summary as a sentence: "3 models, 1 block, 1 plugin will be exported
 * · 4 not exported". A kind with nothing in the file is left out.
 */
export function exportSummaryText(
  summary: ExportSummary,
  count: Formatters['count'],
) {
  const parts = [
    summary.models > 0 ? count(summary.models, 'model', 'models') : null,
    summary.blocks > 0 ? count(summary.blocks, 'block', 'blocks') : null,
    summary.plugins > 0 ? count(summary.plugins, 'plugin', 'plugins') : null,
  ].filter((part): part is string => part !== null);

  const exported =
    parts.length > 0
      ? `${parts.join(', ')} will be exported`
      : 'Nothing will be exported';

  return summary.notExported > 0
    ? `${exported} · ${count(summary.notExported, 'not exported', 'not exported')}`
    : exported;
}
