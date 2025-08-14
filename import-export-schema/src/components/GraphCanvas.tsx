import type { NodeMouseHandler, NodeTypes } from '@xyflow/react';
import { Background, ReactFlow } from '@xyflow/react';
import type { AppNode, Graph } from '@/utils/graph/types';

type Props = {
  graph: Graph;
  nodeTypes: NodeTypes;
  edgeTypes: Parameters<typeof ReactFlow>[0]['edgeTypes'];
  onNodeClick?: NodeMouseHandler<AppNode> | NodeMouseHandler;
  style?: React.CSSProperties;
  fitView?: boolean;
};

export function GraphCanvas({
  graph,
  nodeTypes,
  edgeTypes,
  onNodeClick,
  style,
  fitView = true,
}: Props) {
  return (
    <ReactFlow
      style={style}
      fitView={fitView}
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
    </ReactFlow>
  );
}
