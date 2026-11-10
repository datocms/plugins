import type { SchemaTypes } from '@datocms/cma-client';
import {
  BaseEdge,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  useInternalNode,
  useNodesData,
} from '@xyflow/react';
import classNames from 'classnames';
import HoverCard from 'datocms-react-ui/HoverCard';
import RawButton from 'datocms-react-ui/RawButton';
import { getBezierPath, getSelfPath } from './bezier';
import { FieldRows } from './FieldList';
import s from './graph.module.css';
import type { ItemTypeNode } from './ItemTypeNodeRenderer';
import type { PluginNode } from './PluginNodeRenderer';

/**
 * What the export does with a link: `included` when both ends are in the
 * file, `linkDropped` when only its source is (its fields lose the link),
 * `excluded` when its source is not in the file. The import sets none.
 */
export type FieldEdgeExportState = 'included' | 'linkDropped' | 'excluded';

export type FieldEdge = Edge<
  { fields: SchemaTypes.Field[]; exportState?: FieldEdgeExportState },
  'field'
>;

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
 * The words of an export state, in the name of the dot and under its list
 * of fields: the dashed line alone does not tell it.
 */
function exportNote(
  exportState: FieldEdgeExportState | undefined,
  sourceNode: GraphNodeData | undefined,
  targetNode: GraphNodeData | undefined,
) {
  if (exportState === 'linkDropped') {
    const targetName = nodeName(targetNode);
    return targetName
      ? `“${targetName}” is not exported: these fields lose the link.`
      : 'Not exported: these fields lose the link.';
  }
  if (exportState === 'excluded') {
    const sourceName = nodeName(sourceNode);
    return sourceName ? `“${sourceName}” is not exported.` : 'Not exported.';
  }
  return undefined;
}

/**
 * An edge between two nodes, with a dot that lists the fields behind the
 * link. The dot is a button, thus the list opens on hover and on keyboard
 * focus. In the export, the line and the dot show whether the link goes in
 * the file.
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
  const exportState = data?.exportState;
  const [sourceNode, targetNode] = useNodesData<ItemTypeNode | PluginNode>([
    source,
    target,
  ]);
  const note = exportNote(exportState, sourceNode, targetNode);
  // The box of the source, for the loop of a node to itself
  const sourceBox = useInternalNode(source);

  const [edgePath, labelX, labelY] =
    source === target && sourceBox
      ? getSelfPath(
          sourceBox.internals.positionAbsolute.x +
            (sourceBox.measured.width ?? 0),
          sourceBox.internals.positionAbsolute.y,
        )
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
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={style}
        className={classNames(
          exportState === 'included' && s.edgeIncluded,
          exportState && exportState !== 'included' && s.edgeExcluded,
        )}
      />

      <EdgeLabelRenderer>
        <HoverCard
          content={
            fields.length > 0 ? (
              <HoverCard.Body>
                <FieldRows fields={fields} />
                {note ? <HoverCard.Note>{note}</HoverCard.Note> : null}
              </HoverCard.Body>
            ) : null
          }
        >
          <RawButton
            className={classNames(
              s.edgeDot,
              exportState === 'included' && s.edgeDotIncluded,
            )}
            ariaLabel={
              note
                ? `${edgeDotLabel(sourceNode, targetNode)}. ${note}`
                : edgeDotLabel(sourceNode, targetNode)
            }
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            }}
          />
        </HoverCard>
      </EdgeLabelRenderer>
    </>
  );
}
