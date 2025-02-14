import type { SchemaTypes } from '@datocms/cma-client';
import {
  BaseEdge,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
} from '@xyflow/react';
import { Field } from '../components/Field';
import { getBezierPath, getSelfPath } from './bezier';

export type FieldEdge = Edge<{ fields: SchemaTypes.Field[] }, 'field'>;

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
  const fields = data!.fields;

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
        <div
          className="fieldEdge"
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
          }}
        >
          <div className="fieldEdge__tooltip">
            {fields.map((field) => (
              <Field key={field.id} field={field} />
            ))}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
