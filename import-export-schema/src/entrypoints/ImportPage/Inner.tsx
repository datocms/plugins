import type { SchemaTypes } from '@datocms/cma-client';
import {
  Background,
  type NodeMouseHandler,
  type NodeTypes,
  ReactFlow,
  useReactFlow,
} from '@xyflow/react';
import { Button } from 'datocms-react-ui';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { GRAPH_NODE_THRESHOLD } from '@/shared/constants/graph';
import { type AppNode, edgeTypes, type Graph } from '@/utils/graph/types';
import type { ProjectSchema } from '@/utils/ProjectSchema';
import type { ExportSchema } from '../ExportPage/ExportSchema';
import { buildGraphFromExportDoc } from './buildGraphFromExportDoc';
import ConflictsManager from './ConflictsManager';
import { ImportItemTypeNodeRenderer } from './ImportItemTypeNodeRenderer';
import { ImportPluginNodeRenderer } from './ImportPluginNodeRenderer';
import { useSkippedItemsAndPluginIds } from './ResolutionsForm';
import { SelectedEntityContext } from '@/components/SchemaOverview/SelectedEntityContext';
import { GraphEntitiesContext } from './GraphEntitiesContext';

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
  const { fitBounds, fitView, setNodes, setEdges } = useReactFlow();
  const { skippedItemTypeIds, skippedPluginIds } =
    useSkippedItemsAndPluginIds();

  const [graph, setGraph] = useState<Graph | undefined>();
  const [forceRenderGraph, setForceRenderGraph] = useState(false);
  const [pendingZoomEntity, setPendingZoomEntity] = useState<
    SchemaTypes.ItemType | SchemaTypes.Plugin | null | undefined
  >(undefined);

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

  const requestCancel = useCallback(() => {
    window.dispatchEvent(new CustomEvent('import:request-cancel'));
  }, []);

  const totalPotentialNodes =
    exportSchema.itemTypes.length + exportSchema.plugins.length;

  const graphTooLarge =
    !!graph &&
    (graph.nodes.length > GRAPH_NODE_THRESHOLD ||
      totalPotentialNodes > GRAPH_NODE_THRESHOLD);

  useEffect(() => {
    if (!graphTooLarge && forceRenderGraph) {
      setForceRenderGraph(false);
    }
  }, [graphTooLarge, forceRenderGraph]);

  // Prefer the interactive graph for small/medium selections; allow manual override otherwise.
  const showGraph = !!graph && (!graphTooLarge || forceRenderGraph);

  useEffect(() => {
    if (!graph) {
      setNodes([]);
      setEdges([]);
      return;
    }

    if (!showGraph) {
      setNodes(graph.nodes);
      setEdges(graph.edges);
    }
  }, [graph, showGraph, setNodes, setEdges]);

  const graphEntitySets = useMemo(() => {
    const itemTypeIds = new Set<string>();
    const pluginIds = new Set<string>();

    if (graph) {
      for (const node of graph.nodes) {
        if (node.type === 'itemType') {
          itemTypeIds.add(node.data.itemType.id);
        }
        if (node.type === 'plugin') {
          pluginIds.add(node.data.plugin.id);
        }
      }
    }

    return { itemTypeIds, pluginIds };
  }, [graph]);

  useEffect(() => {
    if (!showGraph || pendingZoomEntity === undefined || !graph) {
      return;
    }

    if (pendingZoomEntity === null) {
      fitView({ duration: 800 });
      setPendingZoomEntity(undefined);
      return;
    }

    const node = graph.nodes.find((node) =>
      pendingZoomEntity.type === 'plugin'
        ? node.type === 'plugin' && node.data.plugin.id === pendingZoomEntity.id
        : node.type === 'itemType' &&
          node.data.itemType.id === pendingZoomEntity.id,
    );

    if (!node) {
      setPendingZoomEntity(undefined);
      return;
    }

    fitBounds(
      { x: node.position.x, y: node.position.y, width: 200, height: 200 },
      { duration: 800, padding: 1 },
    );
    setPendingZoomEntity(undefined);
  }, [fitBounds, fitView, graph, pendingZoomEntity, showGraph]);

  // Zoom the viewport to the full graph once React Flow has mounted and the graph is visible.
  useEffect(() => {
    if (!showGraph) {
      return;
    }
    const timeout = window.setTimeout(() => fitView(), 100);
    return () => window.clearTimeout(timeout);
  }, [fitView, showGraph, graph?.nodes.length]);

  const handleSelectEntity = useCallback(
    (
      newEntity: undefined | SchemaTypes.ItemType | SchemaTypes.Plugin,
      zoomIn?: boolean,
    ) => {
      setSelectedEntity(newEntity);

      if (!zoomIn) {
        return;
      }

      setPendingZoomEntity(newEntity ?? null);
    },
    [graphTooLarge],
  );

  return (
    <GraphEntitiesContext.Provider
      value={{
        hasItemTypeNode: (id) => graphEntitySets.itemTypeIds.has(id),
        hasPluginNode: (id) => graphEntitySets.pluginIds.has(id),
      }}
    >
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
            <div className="import__graph-close">
              <Button
                type="button"
                buttonSize="s"
                buttonType="muted"
                leftIcon={<FontAwesomeIcon icon={faXmark} />}
                onClick={requestCancel}
              >
                Close
              </Button>
            </div>
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
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textAlign: 'center',
                  padding: '0 24px',
                  gap: 16,
                }}
              >
                <div style={{ fontWeight: 600 }}>
                  This graph has {graph.nodes.length} nodes. Trying to render it may slow
                  down your browser.
                </div>
                <Button
                  type="button"
                  buttonSize="s"
                  onClick={() => setForceRenderGraph(true)}
                >
                  Render it anyway
                </Button>
              </div>
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
    </GraphEntitiesContext.Provider>
  );
}
