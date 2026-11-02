import type {
  NodeMouseHandler,
  NodeTypes,
  Rect,
  XYPosition,
} from '@xyflow/react';
import {
  Background,
  getViewportForBounds,
  ReactFlow,
  useReactFlow,
  useStoreApi,
  type Viewport,
} from '@xyflow/react';
import { useCtx } from 'datocms-react-ui/Canvas';
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';
import { SelectedEntityContext } from '@/components/SchemaOverview/SelectedEntityContext';
import type { AppNode, Graph } from '@/utils/graph/types';
import s from './graph.module.css';

/**
 * How the graph fits its pane: with a margin, thus no node touches an edge,
 * never smaller than the zoom where the nodes show their kind and API key,
 * and never larger than their natural size, thus the nodes keep one size on
 * every screen, and a fit after a change only moves them. A larger graph
 * overflows the pane, and the user pans to the rest (the overview lists
 * every element).
 */
export const fitViewOptions = { padding: 0.1, minZoom: 0.8, maxZoom: 1 };

// How long the view takes to move to an item opened in the overview
const moveDuration = 800;

/** The box (in the coordinates of the graph) is all in the pane */
function isInView(
  box: Rect,
  { x, y, zoom }: Viewport,
  width: number,
  height: number,
) {
  const left = box.x * zoom + x;
  const top = box.y * zoom + y;
  return (
    left >= 0 &&
    top >= 0 &&
    left + box.width * zoom <= width &&
    top + box.height * zoom <= height
  );
}

/**
 * The two moves of the view of a graph.
 *
 * `fitGraph` fits the whole graph. A graph larger than the pane at the
 * smallest zoom shows its start, the top and the left, where the reader
 * starts: it then overflows only at the bottom and at the right. When that
 * hides a node of the first column (the models the graph starts from), the
 * view moves down to show them, but never past the top of that column.
 * With `keepSize`, the fit never zooms in: after a change of the graph, the
 * nodes keep their size, and only move (or shrink, when the graph grows).
 *
 * `showNode` brings a node into view, with the nodes it links to, at most at
 * its natural size. A node already in view keeps the view as it is.
 *
 * `keepInPlace` pans the view after a change of the graph moved a node from
 * `from` (in the coordinates of the graph): the node stays where it was on
 * screen. It returns false when the graph lacks the node.
 */
export function useGraphView() {
  const store = useStoreApi();
  const { getNodesBounds, setViewport, setCenter } = useReactFlow();

  const fitGraph = useCallback(
    (duration?: number, keepSize = false) => {
      const { width, height, nodes, transform } = store.getState();
      if (nodes.length === 0 || !width || !height) return;

      const bounds = getNodesBounds(nodes);
      const viewport = getViewportForBounds(
        bounds,
        width,
        height,
        fitViewOptions.minZoom,
        keepSize
          ? Math.min(transform[2], fitViewOptions.maxZoom)
          : fitViewOptions.maxZoom,
        fitViewOptions.padding,
      );
      // The margin of the fit, as React Flow counts it
      const marginX = (width - width / (1 + fitViewOptions.padding)) / 2;
      const marginY = (height - height / (1 + fitViewOptions.padding)) / 2;
      if (bounds.width * viewport.zoom > width - 2 * marginX) {
        viewport.x = marginX - bounds.x * viewport.zoom;
      }
      if (bounds.height * viewport.zoom > height - 2 * marginY) {
        viewport.y = marginY - bounds.y * viewport.zoom;

        const firstX = Math.min(...nodes.map((node) => node.position.x));
        const firstColumn = getNodesBounds(
          nodes.filter((node) => node.position.x === firstX),
        );
        const hidden =
          (firstColumn.y + firstColumn.height) * viewport.zoom +
          viewport.y -
          (height - marginY);
        const room = (firstColumn.y - bounds.y) * viewport.zoom;
        if (hidden > 0) {
          viewport.y -= Math.min(hidden, room);
        }
      }
      void setViewport(viewport, { duration });
    },
    [getNodesBounds, setViewport, store],
  );

  const showNode = useCallback(
    (nodeId: string) => {
      const { width, height, transform, edges } = store.getState();
      const box = getNodesBounds([nodeId]);
      if (!box.width || !width || !height) return;

      const [x, y, zoom] = transform;
      if (isInView(box, { x, y, zoom }, width, height)) return;

      const linkedIds = edges.flatMap((edge) =>
        edge.source === nodeId
          ? [edge.target]
          : edge.target === nodeId
            ? [edge.source]
            : [],
      );
      const viewport = getViewportForBounds(
        getNodesBounds([nodeId, ...linkedIds]),
        width,
        height,
        fitViewOptions.minZoom,
        1,
        0.2,
      );

      // Too far apart to fit together: the node alone, in the center
      if (!isInView(box, viewport, width, height)) {
        void setCenter(box.x + box.width / 2, box.y + box.height / 2, {
          zoom: viewport.zoom,
          duration: moveDuration,
        });
        return;
      }

      void setViewport(viewport, { duration: moveDuration });
    },
    [getNodesBounds, setCenter, setViewport, store],
  );

  const keepInPlace = useCallback(
    (nodeId: string, from: XYPosition) => {
      const { nodeLookup, transform } = store.getState();
      const to = nodeLookup.get(nodeId)?.position;
      if (!to) return false;

      const [x, y, zoom] = transform;
      void setViewport({
        x: x + (from.x - to.x) * zoom,
        y: y + (from.y - to.y) * zoom,
        zoom,
      });
      return true;
    },
    [setViewport, store],
  );

  return { fitGraph, showNode, keepInPlace };
}

type Props = {
  graph: Graph;
  nodeTypes: NodeTypes;
  edgeTypes: Parameters<typeof ReactFlow>[0]['edgeTypes'];
  onNodeClick?: NodeMouseHandler<AppNode> | NodeMouseHandler;
  /** Runs on a click on the empty canvas, for example to clear the focus */
  onPaneClick?: (event: React.MouseEvent) => void;
  style?: React.CSSProperties;
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
}: Props) {
  // The library's own defaults follow the color scheme of the CMS
  const { colorScheme } = useCtx();
  const { fitGraph, keepInPlace } = useGraphView();
  const focused = useContext(SelectedEntityContext).entity;
  const focusedNodeId = focused
    ? `${focused.type === 'plugin' ? 'plugin' : 'itemType'}--${focused.id}`
    : undefined;

  const nodeIds = graph.nodes.map((node) => node.id).join();
  const fittedRef = useRef(false);
  // The nodes of the last render, and the nodes for which the focused node
  // kept its place
  const shownNodesRef = useRef(graph.nodes);
  const keptForRef = useRef<string | undefined>(undefined);

  // After the first fit, a change of the graph (a choice in the overview)
  // keeps the focused node where it was on screen: the picture never moves
  // under the user. Before the paint, thus the node never jumps.
  useLayoutEffect(() => {
    const before = shownNodesRef.current;
    shownNodesRef.current = graph.nodes;
    if (before === graph.nodes) return;

    const from =
      fittedRef.current && focusedNodeId
        ? before.find((node) => node.id === focusedNodeId)?.position
        : undefined;
    keptForRef.current =
      from && focusedNodeId && keepInPlace(focusedNodeId, from)
        ? nodeIds
        : undefined;
  }, [focusedNodeId, graph.nodes, keepInPlace, nodeIds]);

  // The split gives the pane its width after the first render: fit the
  // graph again then, and whenever its nodes change. After the first fit,
  // a change without a focus only moves the nodes: they keep their size.
  useEffect(() => {
    if (!nodeIds) return;
    const timeout = window.setTimeout(() => {
      if (!(fittedRef.current && keptForRef.current === nodeIds)) {
        fitGraph(undefined, fittedRef.current);
      }
      fittedRef.current = true;
    }, 100);
    return () => window.clearTimeout(timeout);
  }, [fitGraph, nodeIds]);

  return (
    <ReactFlow
      className={s.canvas}
      colorMode={colorScheme}
      style={style}
      fitView
      fitViewOptions={fitViewOptions}
      nodes={graph.nodes}
      edges={graph.edges}
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
      // The wheel scrolls the graph as it scrolls a page: a pinch (or the
      // wheel with Ctrl) zooms
      panOnScroll
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
