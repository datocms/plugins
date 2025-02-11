import type { SchemaTypes } from '@datocms/cma-client';
import {
  Background,
  MiniMap,
  type NodeMouseHandler,
  Panel,
  ReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ItemTypeManager } from '@/utils/itemTypeManager';
import { type AppNode, type Graph, edgeTypes, nodeTypes } from '@/utils/types';
import { without } from 'lodash-es';
import { useCallback, useEffect, useState } from 'react';
import { SelectedEntitiesContext } from './SelectedEntitiesContext';
import { buildGraphFromSchema } from './buildGraphFromSchema';
import { useAnimatedNodes } from './useAnimatedNodes';
import { useExpandCollapse } from './useExpandCollapse';
import { useCtx } from 'datocms-react-ui';
import { RenderModalCtx } from 'datocms-plugin-sdk';

type Props = {
  initialItemType: SchemaTypes.ItemType;
  schema: ItemTypeManager;
  onExport: (itemTypeIds: string[], pluginIds: string[]) => void;
};

export default function ExportGraphRenderer({
  initialItemType,
  schema,
  onExport,
}: Props) {
  const ctx = useCtx<RenderModalCtx>();
  const [graph, setGraph] = useState<Graph | undefined>();

  const [selectedItemTypeIds, setSelectedItemTypeIds] = useState<string[]>([
    initialItemType.id,
  ]);

  const [selectedPluginIds, setSelectedPluginIds] = useState<string[]>([]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  useEffect(() => {
    async function run() {
      if (!initialItemType) {
        return;
      }

      const graph = await buildGraphFromSchema({
        initialItemType,
        selectedItemTypeIds,
        schema,
      });

      setGraph(graph);
    }

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialItemType, selectedItemTypeIds.sort().join('-'), schema]);

  const { nodes: visibleNodes, edges: visibleEdges } = useExpandCollapse(
    graph || { nodes: [], edges: [] },
    selectedItemTypeIds,
  );

  const { nodes: animatedNodes } = useAnimatedNodes(visibleNodes, {
    animationDuration: 300,
  });

  const onNodeClick: NodeMouseHandler<AppNode> = useCallback(
    (_, node) => {
      if (node.type === 'itemType') {
        if (node.id === initialItemType.id) {
          return;
        }

        setSelectedItemTypeIds((old) =>
          old.includes(node.data.itemType.id)
            ? without(old, node.data.itemType.id)
            : [...old, node.data.itemType.id],
        );
      }

      if (node.type === 'plugin') {
        setSelectedPluginIds((old) =>
          old.includes(node.data.plugin.id)
            ? without(old, node.data.plugin.id)
            : [...old, node.data.plugin.id],
        );
      }
    },
    [initialItemType.id],
  );

  if (!graph) {
    return null;
  }

  return (
    <SelectedEntitiesContext.Provider
      value={{ itemTypeIds: selectedItemTypeIds, pluginIds: selectedPluginIds }}
    >
      <div className="export-wrapper">
        <ReactFlow
          style={{ position: 'absolute' }}
          fitView={true}
          nodes={animatedNodes}
          edges={visibleEdges}
          onNodeClick={onNodeClick}
          nodesDraggable={false}
          nodesConnectable={false}
          zoomOnDoubleClick={false}
          elementsSelectable={false}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <MiniMap />
          <Panel position="bottom-center">
            <button
              type="button"
              onClick={() => onExport(selectedItemTypeIds, selectedPluginIds)}
            >
              Export {selectedItemTypeIds.length} elements
            </button>
          </Panel>
        </ReactFlow>
      </div>
    </SelectedEntitiesContext.Provider>
  );
}
