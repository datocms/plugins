import { type AppNode, edgeTypes, nodeTypes } from '@/utils/types';
import {
  Background,
  MiniMap,
  type NodeMouseHandler,
  ReactFlow,
} from '@xyflow/react';
import { useCallback, useMemo } from 'react';
import type { ExportDoc } from '../ExportModal/buildExportDoc';
import { buildGraphFromExportDoc } from './buildGraphFromExportDoc';

type Props = {
  exportDoc: ExportDoc;
};

export function Import({ exportDoc }: Props) {
  const graph = useMemo(() => {
    return buildGraphFromExportDoc(exportDoc);
  }, [exportDoc]);

  const onNodeClick: NodeMouseHandler<AppNode> = useCallback(() => {}, []);

  return (
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
  );
}
