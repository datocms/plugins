import type { AppNode } from '@/utils/graph/types';
import { useReactFlow } from '@xyflow/react';
import { timer } from 'd3-timer';
import { useEffect, useState } from 'react';
import { easing } from 'ts-easing';

export function useAnimatedNodes(
  initialNodes: AppNode[],
  { animationDuration = 300 } = {},
) {
  const [nodes, setNodes] = useState<AppNode[]>(initialNodes);
  const { getNode } = useReactFlow();

  useEffect(() => {
    const wantedPositionChanges = initialNodes.map((initialNode) => {
      const currentNode = getNode(initialNode.id);

      return {
        id: initialNode.id,
        from:
          (currentNode == null ? undefined : currentNode.position) ??
          initialNode.position,
        to: initialNode.position,
        node: initialNode,
      };
    });

    const t = timer((elapsed) => {
      const percentElapsed = easing.inOutCubic(elapsed / animationDuration);

      const movedNodes = wantedPositionChanges.map(({ node, from, to }) => ({
        ...node,
        position: {
          x: from.x + (to.x - from.x) * percentElapsed,
          y: from.y + (to.y - from.y) * percentElapsed,
        },
      }));

      setNodes(movedNodes);

      if (elapsed > animationDuration) {
        setNodes(initialNodes);
        t.stop();
      }
    });

    return () => t.stop();
  }, [initialNodes, getNode, animationDuration]);

  return nodes;
}
