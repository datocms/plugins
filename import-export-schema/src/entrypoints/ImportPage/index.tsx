import { ItemTypeManager } from '@/utils/itemTypeManager';
import { type AppNode, edgeTypes, nodeTypes } from '@/utils/types';
import { type SchemaTypes, buildClient } from '@datocms/cma-client';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Background,
  MiniMap,
  type NodeMouseHandler,
  ReactFlow,
} from '@xyflow/react';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Button, Canvas } from 'datocms-react-ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ExportDoc } from '../ExportPage/buildExportDoc';
import { ConflictsContext } from './ConflictsContext';
import FileDropZone from './FileDropZone';
import {
  SelectedEntityContext,
  SelectedEntityProvider,
} from './SelectedEntityContext';
import buildConflicts, { type Conflicts } from './buildConflicts';
import { buildGraphFromExportDoc } from './buildGraphFromExportDoc';
type Props = {
  ctx: RenderPageCtx;
};

export function ImportPage({ ctx }: Props) {
  const [exportDoc, setExportDoc] = useState<[string, ExportDoc] | undefined>();

  const [selectedEntity, setSelectedEntity] = useState<
    undefined | SchemaTypes.ItemType | SchemaTypes.Plugin
  >();

  async function handleImport(filename: string, doc: ExportDoc) {
    setExportDoc([filename, doc]);
  }

  const schema = useMemo(() => {
    const client = buildClient({
      apiToken: ctx.currentUserAccessToken!,
      environment: ctx.environment,
    });
    return new ItemTypeManager(client);
  }, [ctx.currentUserAccessToken, ctx.environment]);

  const [conflicts, setConflicts] = useState<Conflicts | undefined>();

  useEffect(() => {
    async function run() {
      if (!exportDoc) {
        return;
      }
      setConflicts(await buildConflicts(exportDoc[1], schema));
    }

    run();
  }, [exportDoc, schema]);

  const graph = useMemo(() => {
    if (!exportDoc) {
      return undefined;
    }

    return buildGraphFromExportDoc(exportDoc[1]);
  }, [exportDoc]);

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

  return (
    <Canvas ctx={ctx}>
      <div className="page">
        <div className="page__toolbar">
          {exportDoc ? (
            <>
              <div className="page__toolbar__title">
                Import "{exportDoc[0]}"
              </div>
              <div className="page__toolbar__actions">
                <Button
                  leftIcon={<FontAwesomeIcon icon={faXmark} />}
                  buttonSize="s"
                  onClick={() => setExportDoc(undefined)}
                >
                  Close
                </Button>
              </div>
            </>
          ) : (
            <div className="page__toolbar__title">Import schema from JSON</div>
          )}
        </div>
        <div className="page__content">
          <FileDropZone onJsonDrop={handleImport}>
            {graph && conflicts ? (
              <div className="import">
                <div className="import__graph">
                  <ConflictsContext.Provider value={conflicts}>
                    <SelectedEntityContext.Provider
                      value={{ entity: selectedEntity, set: setSelectedEntity }}
                    >
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
                    </SelectedEntityContext.Provider>
                  </ConflictsContext.Provider>
                </div>
                {selectedEntity && (
                  <div className="import__details">
                    Schemata per gestire i conflitti!
                    <pre>{JSON.stringify(selectedEntity, null, 2)}</pre>
                  </div>
                )}
              </div>
            ) : (
              <div className="blank-slate">
                <div className="blank-slate__content">
                  Please drop an export JSON file
                </div>
              </div>
            )}
          </FileDropZone>
        </div>
      </div>
    </Canvas>
  );
}
