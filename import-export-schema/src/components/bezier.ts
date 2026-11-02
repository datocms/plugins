import { type GetBezierPathParams, Position } from '@xyflow/react';

/**
 * The edge of a node to itself: a small loop at the top right corner of the
 * node (`right`, `top`), out of its right side and back into its top side.
 * It stays in the free space around the corner: the pills of the node are in
 * the middle of its top side, and the next nodes are above, below and to the
 * right. The dot sits at the middle of the loop, outside the box.
 */
export function getSelfPath(
  right: number,
  top: number,
): [string, number, number] {
  // How far from the corner the loop leaves and enters the box, and how far
  // out it goes
  const inset = 14;
  const reach = 50;

  const start = [right, top + inset];
  const control1 = [right + reach, top + inset];
  const control2 = [right - inset, top - reach];
  const end = [right - inset, top];

  // The middle of a cubic curve: (P0 + 3·P1 + 3·P2 + P3) / 8
  const middle = (axis: 0 | 1) =>
    (start[axis] + 3 * control1[axis] + 3 * control2[axis] + end[axis]) / 8;

  return [
    `M ${start[0]} ${start[1]} C ${control1[0]} ${control1[1]}, ${control2[0]} ${control2[1]}, ${end[0]} ${end[1]}`,
    middle(0),
    middle(1),
  ];
}

function bezierInterpolation(
  t: number,
  p0: number, // start point
  p1: number, // first control point
  p2: number, // second control point
  p3: number, // end point
): number {
  const oneMinusT = 1 - t;
  const oneMinusT2 = oneMinusT * oneMinusT;
  const oneMinusT3 = oneMinusT2 * oneMinusT;
  const t2 = t * t;
  const t3 = t2 * t;

  return (
    oneMinusT3 * p0 + // (1-t)³ * P₀
    3 * oneMinusT2 * t * p1 + // 3(1-t)² * t * P₁
    3 * oneMinusT * t2 * p2 + // 3(1-t) * t² * P₂
    t3 * p3 // t³ * P₃
  );
}

function calculateControlOffset(distance: number, curvature: number) {
  if (distance >= 0) {
    return 0.5 * distance;
  }
  return curvature * 25 * Math.sqrt(-distance);
}

type GetControlWithCurvatureParams = {
  pos: Position;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  c: number;
};

function getControlWithCurvature({
  pos,
  x1,
  y1,
  x2,
  y2,
  c,
}: GetControlWithCurvatureParams) {
  switch (pos) {
    case Position.Left:
      return [x1 - calculateControlOffset(x1 - x2, c), y1];
    case Position.Right:
      return [x1 + calculateControlOffset(x2 - x1, c), y1];
    case Position.Top:
      return [x1, y1 - calculateControlOffset(y1 - y2, c)];
    case Position.Bottom:
      return [x1, y1 + calculateControlOffset(y2 - y1, c)];
  }
}

function calculateBezierLength(
  sourceX: number,
  sourceY: number,
  sourceControlX: number,
  sourceControlY: number,
  targetControlX: number,
  targetControlY: number,
  targetX: number,
  targetY: number,
  t0: number,
  t1: number,
  steps = 10,
): number {
  let length = 0;
  let prevX = sourceX;
  let prevY = sourceY;

  for (let i = 1; i <= steps; i++) {
    const t = t0 + (t1 - t0) * (i / steps);
    const x = bezierInterpolation(
      t,
      sourceX,
      sourceControlX,
      targetControlX,
      targetX,
    );
    const y = bezierInterpolation(
      t,
      sourceY,
      sourceControlY,
      targetControlY,
      targetY,
    );
    length += Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
    prevX = x;
    prevY = y;
  }

  return length;
}

/**
 * Find the t value for which the arc length of the cubic Bézier curve equals the target length
 */
function getTForLength(
  sourceX: number,
  sourceY: number,
  sourceControlX: number,
  sourceControlY: number,
  targetControlX: number,
  targetControlY: number,
  targetX: number,
  targetY: number,
  targetLength: number,
  tolerance = 0.01,
): number {
  let low = 0;
  let high = 1;
  let t = 0.5;

  while (high - low > tolerance) {
    t = (low + high) / 2;
    const length = calculateBezierLength(
      sourceX,
      sourceY,
      sourceControlX,
      sourceControlY,
      targetControlX,
      targetControlY,
      targetX,
      targetY,
      0,
      t,
    );

    if (Math.abs(length - targetLength) < tolerance) {
      return t;
    }
    if (length < targetLength) {
      low = t;
    } else {
      high = t;
    }
  }

  return t;
}

export function getBezierPath({
  sourceX,
  sourceY,
  sourcePosition = Position.Bottom,
  targetX,
  targetY,
  targetPosition = Position.Top,
  curvature = 0.25,
}: GetBezierPathParams): [string, number, number] {
  const [sourceControlX, sourceControlY] = getControlWithCurvature({
    pos: sourcePosition,
    x1: sourceX,
    y1: sourceY,
    x2: targetX,
    y2: targetY,
    c: curvature,
  });

  const [targetControlX, targetControlY] = getControlWithCurvature({
    pos: targetPosition,
    x1: targetX,
    y1: targetY,
    x2: sourceX,
    y2: sourceY,
    c: curvature,
  });

  const labelPercent = getTForLength(
    targetX,
    targetY,
    targetControlX,
    targetControlY,
    sourceControlX,
    sourceControlY,
    sourceX,
    sourceY,
    40,
  );

  const [labelX, labelY] = [
    bezierInterpolation(
      1.0 - labelPercent,
      sourceX,
      sourceControlX,
      targetControlX,
      targetX,
    ),
    bezierInterpolation(
      1.0 - labelPercent,
      sourceY,
      sourceControlY,
      targetControlY,
      targetY,
    ),
  ];

  return [
    `M${sourceX},${sourceY} C${sourceControlX},${sourceControlY} ${targetControlX},${targetControlY} ${targetX},${targetY}`,
    labelX,
    labelY,
  ];
}
