import { type AppNode, edgeTypes, nodeTypes } from '@/utils/types';
import {
  Background,
  MiniMap,
  type NodeMouseHandler,
  ReactFlow,
} from '@xyflow/react';
import { useCallback, useMemo, useState } from 'react';
import type { ExportDoc } from '../ExportModal/buildExportDoc';
import { buildGraphFromExportDoc } from './buildGraphFromExportDoc';
import FileDropZone from './FileDropZone';
import { RenderPageCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';

type Props = {
  cts: RenderPageCtx;
};

export function ImportPage({ ctx }: Props) {
  const [exportDoc, setExportDoc] = useState<ExportDoc | undefined>();

  async function handleImport(doc: ExportDoc) {
    setExportDoc(doc);
  }

  const graph = useMemo(() => {
    if (!exportDoc) {
      return undefined;
    }

    return buildGraphFromExportDoc(exportDoc);
  }, [exportDoc]);

  const onNodeClick: NodeMouseHandler<AppNode> = useCallback(() => {}, []);

  if (!graph) {
    return null;
  }

  return (
    <Canvas ctx={ctx}>
      <FileDropZone onJsonDrop={handleImport}>
        <ReactFlow
          fitView={true}
          nodes={graph.nodes}
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
          <MiniMap />
        </ReactFlow>
      </FileDropZone>
    </Canvas>
  );
}
