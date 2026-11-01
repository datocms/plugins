import type { SchemaTypes } from '@datocms/cma-client';
import {
  BaseEdge,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  useNodesData,
} from '@xyflow/react';
import HoverCard from 'datocms-react-ui/HoverCard';
import RawButton from 'datocms-react-ui/RawButton';
import { getBezierPath, getSelfPath } from './bezier';
import { FieldRows } from './FieldList';
import s from './graph.module.css';
import type { ItemTypeNode } from './ItemTypeNodeRenderer';
import type { PluginNode } from './PluginNodeRenderer';

export type FieldEdge = Edge<{ fields: SchemaTypes.Field[] }, 'field'>;

type GraphNodeData =
  | Pick<ItemTypeNode, 'id' | 'type' | 'data'>
  | Pick<PluginNode, 'id' | 'type' | 'data'>;

function nodeName(node: GraphNodeData | undefined) {
  if (!node) return undefined;
  return node.type === 'plugin'
    ? node.data.plugin.attributes.name
    : node.data.itemType.attributes.name;
}

/**
 * The name of the dot, which tells why the two nodes depend on each other:
 * the fields of the source link to a model or block, or use a plugin.
 */
function edgeDotLabel(
  sourceNode: GraphNodeData | undefined,
  targetNode: GraphNodeData | undefined,
) {
  const sourceName = nodeName(sourceNode);
  const targetName = nodeName(targetNode);
  if (!sourceName || !targetName) return 'Fields behind this link';

  return targetNode?.type === 'plugin'
    ? `Fields of “${sourceName}” that use “${targetName}”`
    : `Fields of “${sourceName}” that link to “${targetName}”`;
}

/**
 * An edge between two nodes, with a dot that lists the fields behind the
 * link. The dot is a button, thus the list opens on hover and on keyboard
 * focus.
 */
export function FieldEdgeRenderer({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
}: EdgeProps<FieldEdge>) {
  const fields = data?.fields ?? [];
  const [sourceNode, targetNode] = useNodesData<ItemTypeNode | PluginNode>([
    source,
    target,
  ]);

  const [edgePath, labelX, labelY] =
    source === target
      ? getSelfPath({
          sourceX,
          sourceY,
          sourcePosition,
          targetX,
          targetY,
          targetPosition,
        })
      : getBezierPath({
          sourceX,
          sourceY,
          sourcePosition,
          targetX,
          targetY,
          targetPosition,
        });

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />

      <EdgeLabelRenderer>
        <HoverCard
          content={
            fields.length > 0 ? (
              <HoverCard.Body>
                <FieldRows fields={fields} />
              </HoverCard.Body>
            ) : null
          }
        >
          <RawButton
            className={s.edgeDot}
            ariaLabel={edgeDotLabel(sourceNode, targetNode)}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            }}
          />
        </HoverCard>
      </EdgeLabelRenderer>
    </>
  );
}
