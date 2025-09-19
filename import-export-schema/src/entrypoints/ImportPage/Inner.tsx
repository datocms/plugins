import type { SchemaTypes } from '@datocms/cma-client';
import {
  Background,
  type NodeMouseHandler,
  type NodeTypes,
  ReactFlow,
  useReactFlow,
} from '@xyflow/react';
import { useCallback, useEffect, useState } from 'react';
import { GRAPH_NODE_THRESHOLD } from '@/shared/constants/graph';
import { type AppNode, edgeTypes, type Graph } from '@/utils/graph/types';
import type { ProjectSchema } from '@/utils/ProjectSchema';
import type { ExportSchema } from '../ExportPage/ExportSchema';
import { buildGraphFromExportDoc } from './buildGraphFromExportDoc';
import ConflictsManager from './ConflictsManager';
import { ImportItemTypeNodeRenderer } from './ImportItemTypeNodeRenderer';
import { ImportPluginNodeRenderer } from './ImportPluginNodeRenderer';
import LargeSelectionView from './LargeSelectionView';
import { useSkippedItemsAndPluginIds } from './ResolutionsForm';
import { SelectedEntityContext } from '@/components/SchemaOverview/SelectedEntityContext';

// Map React Flow node types to the dedicated renderers for import graphs.
const nodeTypes: NodeTypes = {
  itemType: ImportItemTypeNodeRenderer,
  plugin: ImportPluginNodeRenderer,
};

type Props = {
  exportSchema: ExportSchema;
  schema: ProjectSchema;
  ctx: import('datocms-plugin-sdk').RenderPageCtx;
};

/**
 * Displays the import graph, helps the user inspect potential conflicts, and keeps
 * the selection in sync with the conflict resolution form.
 */
export function Inner({ exportSchema, schema, ctx: _ctx }: Props) {
  const { fitBounds, fitView } = useReactFlow();
  const { skippedItemTypeIds, skippedPluginIds } =
    useSkippedItemsAndPluginIds();

  // Zoom the viewport to the full graph once React Flow has mounted.
  useEffect(() => {
    setTimeout(() => fitView(), 100);
  }, []);

  const [graph, setGraph] = useState<Graph | undefined>();

  // Rebuild the graph when the export document or skip lists change.
  useEffect(() => {
    async function run() {
      setGraph(await buildGraphFromExportDoc(exportSchema, skippedItemTypeIds));
    }

    run();
  }, [exportSchema, skippedItemTypeIds.join('-'), skippedPluginIds.join('-')]);

  const [selectedEntity, setSelectedEntity] = useState<
    undefined | SchemaTypes.ItemType | SchemaTypes.Plugin
  >();

  const onNodeClick: NodeMouseHandler<AppNode> = useCallback((e, node) => {
    e.stopPropagation();

    setSelectedEntity(
      node.type === 'itemType'
        ? node.data.itemType
        : node.type === 'plugin'
          ? node.data.plugin
          : undefined,
    );
  }, []);

  // Allow external panels to highlight a specific entity while animating the view.
  function handleSelectEntity(
    newEntity: undefined | SchemaTypes.ItemType | SchemaTypes.Plugin,
    zoomIn?: boolean,
  ) {
    setSelectedEntity(newEntity);

    if (zoomIn && graph) {
      if (newEntity) {
        const node = graph.nodes.find((node) =>
          newEntity.type === 'plugin'
            ? node.type === 'plugin' && node.data.plugin.id === newEntity.id
            : node.type === 'itemType' &&
              node.data.itemType.id === newEntity.id,
        );
        if (!node) return;

        fitBounds(
          { x: node.position.x, y: node.position.y, width: 200, height: 200 },
          { duration: 800, padding: 1 },
        );
      } else {
        fitView({ duration: 800 });
      }
    }
  }

  const totalPotentialNodes =
    exportSchema.itemTypes.length + exportSchema.plugins.length;

  // Prefer the interactive graph for small/medium selections; fall back otherwise.
  const showGraph =
    !!graph &&
    graph.nodes.length <= GRAPH_NODE_THRESHOLD &&
    totalPotentialNodes <= GRAPH_NODE_THRESHOLD;

  return (
    <SelectedEntityContext.Provider
      value={{ entity: selectedEntity, set: handleSelectEntity }}
    >
      <div style={{ display: 'flex', width: '100%', height: '100%' }}>
        <section
          style={{
            width: '66%',
            minWidth: 480,
            position: 'relative',
          }}
          aria-label="Import graph panel"
        >
          <div
            className="import__graph"
            style={{ position: 'relative', height: '100%' }}
          >
            {graph && showGraph && (
              <ReactFlow
                fitView={true}
                nodes={graph.nodes}
                edges={graph.edges}
                nodesDraggable={false}
                nodesConnectable={false}
                zoomOnDoubleClick={false}
                elementsSelectable={false}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                proOptions={{ hideAttribution: true }}
                onClick={() => setSelectedEntity(undefined)}
                onNodeClick={onNodeClick}
              >
                <Background />
              </ReactFlow>
            )}
            {graph && !showGraph && (
              <>
                {/* List view for large selections */}
                <LargeSelectionView
                  graph={graph}
                  onSelect={(entity) => handleSelectEntity(entity, true)}
                />
                {/* Hidden ReactFlow to keep nodes available for Conflicts UI */}
                <div
                  style={{
                    position: 'absolute',
                    width: 1,
                    height: 1,
                    overflow: 'hidden',
                    opacity: 0,
                    pointerEvents: 'none',
                  }}
                  aria-hidden
                >
                  <ReactFlow
                    fitView={false}
                    nodes={graph.nodes}
                    edges={graph.edges}
                    nodesDraggable={false}
                    nodesConnectable={false}
                    elementsSelectable={false}
                    nodeTypes={nodeTypes}
                    edgeTypes={edgeTypes}
                    proOptions={{ hideAttribution: true }}
                  />
                </div>
              </>
            )}
          </div>
        </section>
        <section
          style={{
            width: '33%',
            minWidth: 340,
            position: 'relative',
          }}
          aria-label="Import details panel"
        >
          <div className="import__details">
            <ConflictsManager exportSchema={exportSchema} schema={schema} />
          </div>
        </section>
      </div>
    </SelectedEntityContext.Provider>
  );
}
