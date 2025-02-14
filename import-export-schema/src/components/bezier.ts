import { type GetBezierPathParams, Position } from '@xyflow/react';

function getPointOnSimpleArc(
  arcFraction: number,
  rx: number,
  ry: number,
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
): [number, number] {
  // Step 1. Compute the midpoint and differences.
  const dx = (sourceX - targetX) / 2;
  const dy = (sourceY - targetY) / 2;
  const midX = (sourceX + targetX) / 2;
  const midY = (sourceY + targetY) / 2;

  // Step 2. Compute the factor used to find the center.
  // (This comes from the SVG spec’s “F.6.5 Conversion from endpoint to center parameterization”)
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const dx2 = dx * dx;
  const dy2 = dy * dy;

  // The numerator under the square root:
  const numerator = rx2 * ry2 - rx2 * dy2 - ry2 * dx2;
  // The denominator:
  const denom = rx2 * dy2 + ry2 * dx2;

  // In case of rounding issues, make sure we don’t take sqrt of a negative.
  const factor = Math.sqrt(Math.max(0, numerator / denom));

  // For the flags: largeArcFlag=1 and sweepFlag=0.
  // The spec tells us to choose sign = (largeArcFlag === sweepFlag ? -1 : 1).
  // Since 1 !== 0, we have:
  const sign = 1;

  // Step 3. Compute the center in the “prime” coordinate system.
  const cxPrime = sign * factor * ((rx * dy) / ry);
  const cyPrime = sign * factor * ((-ry * dx) / rx);

  // The actual center is:
  const cx = midX + cxPrime;
  const cy = midY + cyPrime;

  // Step 4. Compute the start and end angles.
  // Since there is no rotation (xAxisRotation=0), we can compute these directly.
  const startAngle = Math.atan2((sourceY - cy) / ry, (sourceX - cx) / rx);
  const endAngle = Math.atan2((targetY - cy) / ry, (targetX - cx) / rx);

  // Step 5. Determine the angle difference.
  let deltaAngle = endAngle - startAngle;
  // For sweepFlag=0 the arc is drawn in the negative (clockwise) direction.
  // If deltaAngle is positive, subtract 2π to get the proper (negative) angle.
  if (deltaAngle > 0) {
    deltaAngle -= 2 * Math.PI;
  }

  // Step 6. Find the angle at the given fraction along the arc.
  const angleAtFraction = startAngle + arcFraction * deltaAngle;

  // Step 7. Convert back to (x,y) coordinates.
  const x = cx + rx * Math.cos(angleAtFraction);
  const y = cy + ry * Math.sin(angleAtFraction);

  return [x, y];
}

export function getSelfPath({
  sourceX,
  targetX,
  sourceY,
  targetY,
}: GetBezierPathParams): [string, number, number] {
  const radiusX = 100;
  const radiusY = (sourceY - targetY) * 0.6;

  const newTargetX = targetX + 2;

  const [labelX, labelY] = getPointOnSimpleArc(
    0.5,
    radiusX,
    radiusY,
    sourceX,
    sourceY,
    newTargetX,
    targetY,
  );

  return [
    `M ${sourceX} ${sourceY} A ${radiusX} ${radiusY} 0 1 0 ${newTargetX} ${targetY}`,
    labelX,
    labelY,
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
