import type { NodeMouseHandler, NodeTypes } from '@xyflow/react';
import { Background, ReactFlow } from '@xyflow/react';
import { useCtx } from 'datocms-react-ui/Canvas';
import type { AppNode, Graph } from '@/utils/graph/types';
import s from './graph.module.css';

type Props = {
  graph: Graph;
  nodeTypes: NodeTypes;
  edgeTypes: Parameters<typeof ReactFlow>[0]['edgeTypes'];
  onNodeClick?: NodeMouseHandler<AppNode> | NodeMouseHandler;
  /** Runs on a click on the empty canvas, for example to clear the focus */
  onPaneClick?: (event: React.MouseEvent) => void;
  style?: React.CSSProperties;
  fitView?: boolean;
};

/**
 * Shared React Flow canvas configuration to keep export/import graphs consistent.
 */
export function GraphCanvas({
  graph,
  nodeTypes,
  edgeTypes,
  onNodeClick,
  onPaneClick,
  style,
  fitView = true,
}: Props) {
  // The library's own defaults follow the color scheme of the CMS
  const { colorScheme } = useCtx();

  return (
    <ReactFlow
      className={s.canvas}
      colorMode={colorScheme}
      style={style}
      fitView={fitView}
      nodes={graph.nodes}
      edges={graph.edges}
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
      // Keep the canvas read-only; selections are handled by higher-level components.
      nodesDraggable={false}
      nodesConnectable={false}
      zoomOnDoubleClick={false}
      elementsSelectable={false}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      proOptions={{ hideAttribution: true }}
      // No inline color on the arrowheads: they take the edge stroke
      // variable that graph.module.css sets to a token
      defaultMarkerColor={null}
    >
      <Background
        color="var(--color--border)"
        bgColor="var(--color--surface)"
      />
    </ReactFlow>
  );
}
