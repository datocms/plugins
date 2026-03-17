import type {
  DetailPanelValue,
  DiffStatus,
  DifferenceEntry,
  SummaryCounts,
} from '../types';
import { deepEqual } from './stable';

function isObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function joinPath(basePath: string, segment: string): string {
  if (!basePath) {
    return segment;
  }

  if (segment.startsWith('[')) {
    return `${basePath}${segment}`;
  }

  return `${basePath}.${segment}`;
}

export function makeSummaryCounts(): SummaryCounts {
  return {
    total: 0,
    changed: 0,
    leftOnly: 0,
    rightOnly: 0,
    unchanged: 0,
  };
}

export function incrementSummary(
  summary: SummaryCounts,
  status: DiffStatus,
) {
  summary.total += 1;
  summary[status] += 1;
}

export function determineDiffStatus(
  leftValue: unknown,
  rightValue: unknown,
): DiffStatus {
  if (typeof leftValue === 'undefined') {
    return 'rightOnly';
  }

  if (typeof rightValue === 'undefined') {
    return 'leftOnly';
  }

  return deepEqual(leftValue, rightValue) ? 'unchanged' : 'changed';
}

export function createDifferenceEntries(
  leftValue: unknown,
  rightValue: unknown,
  path = '',
): DifferenceEntry[] {
  if (deepEqual(leftValue, rightValue)) {
    return [];
  }

  if (typeof leftValue === 'undefined') {
    return [
      {
        path: path || 'value',
        kind: 'added',
        leftValue,
        rightValue,
      },
    ];
  }

  if (typeof rightValue === 'undefined') {
    return [
      {
        path: path || 'value',
        kind: 'removed',
        leftValue,
        rightValue,
      },
    ];
  }

  if (Array.isArray(leftValue) && Array.isArray(rightValue)) {
    const differences: DifferenceEntry[] = [];
    const size = Math.max(leftValue.length, rightValue.length);

    for (let index = 0; index < size; index += 1) {
      differences.push(
        ...createDifferenceEntries(
          leftValue[index],
          rightValue[index],
          joinPath(path, `[${index}]`),
        ),
      );
    }

    return differences;
  }

  if (isObject(leftValue) && isObject(rightValue)) {
    const differences: DifferenceEntry[] = [];
    const keys = Array.from(
      new Set([...Object.keys(leftValue), ...Object.keys(rightValue)]),
    ).sort();

    for (const key of keys) {
      differences.push(
        ...createDifferenceEntries(
          leftValue[key],
          rightValue[key],
          joinPath(path, key),
        ),
      );
    }

    return differences;
  }

  return [
    {
      path: path || 'value',
      kind: 'changed',
      leftValue,
      rightValue,
    },
  ];
}

export function buildDetailValue(
  title: string,
  subtitle: string | undefined,
  status: DiffStatus,
  leftValue: unknown,
  rightValue: unknown,
): DetailPanelValue {
  return {
    title,
    subtitle,
    status,
    leftValue,
    rightValue,
    changes:
      status === 'changed'
        ? createDifferenceEntries(leftValue, rightValue)
        : [],
  };
}
