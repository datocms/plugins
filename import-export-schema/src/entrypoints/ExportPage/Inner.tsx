import type { ProjectSchema } from '@/utils/ProjectSchema';
import type { SchemaTypes } from '@datocms/cma-client';
import { faFileExport, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Background,
  type NodeMouseHandler,
  type NodeTypes,
  Panel,
  ReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { type AppNode, type Graph, edgeTypes } from '@/utils/graph/types';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import {
  Button,
  Toolbar,
  ToolbarStack,
  ToolbarTitle,
  useCtx,
} from 'datocms-react-ui';
import { without } from 'lodash-es';
import { useCallback, useEffect, useState } from 'react';
import { EntitiesToExportContext } from './EntitiesToExportContext';
import { ExportItemTypeNodeRenderer } from './ExportItemTypeNodeRenderer';
import { ExportPluginNodeRenderer } from './ExportPluginNodeRenderer';
import { buildGraphFromSchema } from './buildGraphFromSchema';
import { useAnimatedNodes } from './useAnimatedNodes';

const nodeTypes: NodeTypes = {
  itemType: ExportItemTypeNodeRenderer,
  plugin: ExportPluginNodeRenderer,
};

type Props = {
  initialItemType: SchemaTypes.ItemType;
  schema: ProjectSchema;
  onExport: (itemTypeIds: string[], pluginIds: string[]) => void;
};

export default function Inner({ initialItemType, schema, onExport }: Props) {
  const ctx = useCtx<RenderPageCtx>();

  const [graph, setGraph] = useState<Graph | undefined>();

  const [selectedItemTypeIds, setSelectedItemTypeIds] = useState<string[]>([
    initialItemType.id,
  ]);

  const [selectedPluginIds, setSelectedPluginIds] = useState<string[]>([]);

  useEffect(() => {
    async function run() {
      const graph = await buildGraphFromSchema({
        initialItemType,
        selectedItemTypeIds,
        schema,
      });

      setGraph(graph);
    }

    run();
  }, [initialItemType, selectedItemTypeIds.sort().join('-'), schema]);

  const animatedNodes = useAnimatedNodes(graph ? graph.nodes : [], {
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
    <div className="page">
      <Toolbar className="page__toolbar">
        <ToolbarStack stackSize="l">
          <ToolbarTitle>Export {initialItemType.attributes.name}</ToolbarTitle>
          <div style={{ flex: '1' }} />
          <Button
            leftIcon={<FontAwesomeIcon icon={faXmark} />}
            buttonSize="s"
            onClick={() =>
              ctx.navigateTo(
                `${ctx.isEnvironmentPrimary ? '' : `/environments/${ctx.environment}`}/configuration/p/${ctx.plugin.id}/pages/import-export`,
              )
            }
          >
            Close
          </Button>
        </ToolbarStack>
      </Toolbar>
      <div className="page__content">
        <div className="export-wrapper">
          <EntitiesToExportContext.Provider
            value={{
              itemTypeIds: selectedItemTypeIds,
              pluginIds: selectedPluginIds,
            }}
          >
            {graph && (
              <ReactFlow
                style={{ position: 'absolute' }}
                fitView={true}
                nodes={animatedNodes}
                edges={graph.edges}
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
                <Panel position="bottom-center">
                  <Button
                    type="button"
                    buttonSize="xl"
                    buttonType="primary"
                    leftIcon={<FontAwesomeIcon icon={faFileExport} />}
                    onClick={() =>
                      onExport(selectedItemTypeIds, selectedPluginIds)
                    }
                  >
                    Export {selectedItemTypeIds.length} elements as JSON
                  </Button>
                </Panel>
              </ReactFlow>
            )}
          </EntitiesToExportContext.Provider>
        </div>
      </div>
    </div>
  );
}
