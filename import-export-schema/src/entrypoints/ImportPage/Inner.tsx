import { type AppNode, type Graph, edgeTypes } from '@/utils/graph/types';
import type { ExportDoc } from '@/utils/types';
import type { SchemaTypes } from '@datocms/cma-client';
import {
  Background,
  type NodeMouseHandler,
  type NodeTypes,
  ReactFlow,
  useReactFlow,
} from '@xyflow/react';
import { VerticalSplit } from 'datocms-react-ui';
import { useCallback, useEffect, useState } from 'react';
import ConflictsManager from './ConflictsManager';
import { ImportItemTypeNodeRenderer } from './ImportItemTypeNodeRenderer';
import { ImportPluginNodeRenderer } from './ImportPluginNodeRenderer';
import { useSkippedItemsAndPluginIds } from './ResolutionsForm';
import { SelectedEntityContext } from './SelectedEntityContext';
import { buildGraphFromExportDoc } from './buildGraphFromExportDoc';

const nodeTypes: NodeTypes = {
  itemType: ImportItemTypeNodeRenderer,
  plugin: ImportPluginNodeRenderer,
};

type Props = {
  exportDoc: ExportDoc;
};

export function Inner({ exportDoc }: Props) {
  const { fitBounds, fitView } = useReactFlow();
  const { skippedItemTypeIds, skippedPluginIds } =
    useSkippedItemsAndPluginIds();

  useEffect(() => {
    setTimeout(() => fitView(), 100);
  }, []);

  const [graph, setGraph] = useState<Graph | undefined>();

  useEffect(() => {
    async function run() {
      setGraph(await buildGraphFromExportDoc(exportDoc, skippedItemTypeIds));
    }

    run();
  }, [exportDoc, skippedItemTypeIds.join('-'), skippedPluginIds.join('-')]);

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
        )!;

        fitBounds(
          { x: node.position.x, y: node.position.y, width: 200, height: 200 },
          { duration: 800, padding: 1 },
        );
      } else {
        fitView({ duration: 800 });
      }
    }
  }

  return (
    <SelectedEntityContext.Provider
      value={{ entity: selectedEntity, set: handleSelectEntity }}
    >
      <VerticalSplit primaryPane="left" size="25%" minSize={300}>
        <div className="import__graph">
          {graph && (
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
        </div>
        <div className="import__details">
          <ConflictsManager exportDoc={exportDoc} />
        </div>
      </VerticalSplit>
    </SelectedEntityContext.Provider>
  );
}
