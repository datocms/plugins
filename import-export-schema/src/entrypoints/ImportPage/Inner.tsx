import { type AppNode, edgeTypes, nodeTypes } from '@/utils/types';
import type { SchemaTypes } from '@datocms/cma-client';
import {
  Background,
  type NodeMouseHandler,
  ReactFlow,
  useReactFlow,
} from '@xyflow/react';
import { get } from 'lodash-es';
import { useCallback, useContext, useMemo, useState } from 'react';
import { useFormState } from 'react-final-form';
import type { ExportDoc } from '../ExportPage/buildExportDoc';
import { ConflictsContext } from './ConflictsContext';
import ConflictsManager from './ConflictsManager';
import { SelectedEntityContext } from './SelectedEntityContext';
import { buildGraphFromExportDoc } from './buildGraphFromExportDoc';

type Props = {
  exportDoc: ExportDoc;
};

export function Inner({ exportDoc }: Props) {
  const { fitBounds } = useReactFlow();
  const conflicts = useContext(ConflictsContext)!;
  const formState = useFormState();

  const skippedItemTypeIds = useMemo(
    () =>
      Object.keys(conflicts.itemTypes).filter(
        (itemTypeId) =>
          get(formState.values, `itemType-${itemTypeId}.strategy`) ===
          'reuseExisting',
      ),
    [formState, conflicts],
  );

  const skippedPluginIds = useMemo(
    () =>
      Object.keys(conflicts.plugins).filter(
        (pluginId) =>
          get(formState.values, `plugin-${pluginId}.strategy`) ===
          'reuseExisting',
      ),
    [formState, conflicts],
  );

  const graph = useMemo(() => {
    return buildGraphFromExportDoc(
      exportDoc,
      skippedItemTypeIds,
      skippedPluginIds,
    );
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

    if (zoomIn && newEntity) {
      const node = graph.nodes.find((node) =>
        newEntity.type === 'plugin'
          ? node.type === 'plugin' && node.data.plugin.id === newEntity.id
          : node.type === 'itemType' && node.data.itemType.id === newEntity.id,
      )!;

      fitBounds(
        { x: node.position.x, y: node.position.y, width: 200, height: 200 },
        { duration: 800, padding: 1 },
      );
    }
  }

  return (
    <SelectedEntityContext.Provider
      value={{ entity: selectedEntity, set: handleSelectEntity }}
    >
      <div className="import">
        <div className="import__graph">
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
        </div>
        <div className="import__details">
          <ConflictsManager exportDoc={exportDoc} />
        </div>
      </div>
    </SelectedEntityContext.Provider>
  );
}
