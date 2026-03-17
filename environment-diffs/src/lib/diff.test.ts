import { describe, expect, it } from 'vitest';
import {
  buildDetailValue,
  createDifferenceEntries,
  determineDiffStatus,
  incrementSummary,
  makeSummaryCounts,
} from './diff';

describe('diff helpers', () => {
  it('creates zeroed summary counts and increments them by status', () => {
    const summary = makeSummaryCounts();

    expect(summary).toEqual({
      total: 0,
      changed: 0,
      leftOnly: 0,
      rightOnly: 0,
      unchanged: 0,
    });

    incrementSummary(summary, 'changed');
    incrementSummary(summary, 'leftOnly');
    incrementSummary(summary, 'rightOnly');
    incrementSummary(summary, 'unchanged');

    expect(summary).toEqual({
      total: 4,
      changed: 1,
      leftOnly: 1,
      rightOnly: 1,
      unchanged: 1,
    });
  });

  it('determines diff status from presence and deep equality', () => {
    expect(determineDiffStatus(undefined, 'value')).toBe('rightOnly');
    expect(determineDiffStatus('value', undefined)).toBe('leftOnly');
    expect(determineDiffStatus({ a: 1 }, { a: 1 })).toBe('unchanged');
    expect(determineDiffStatus({ a: 1 }, { a: 2 })).toBe('changed');
  });

  it('creates nested difference entries for objects and arrays', () => {
    expect(
      createDifferenceEntries(
        {
          title: 'Left',
          nested: {
            count: 1,
            values: ['keep', 'left'],
          },
        },
        {
          title: 'Right',
          nested: {
            count: 2,
            values: ['keep', 'right'],
          },
        },
      ),
    ).toEqual([
      {
        path: 'nested.count',
        kind: 'changed',
        leftValue: 1,
        rightValue: 2,
      },
      {
        path: 'nested.values[1]',
        kind: 'changed',
        leftValue: 'left',
        rightValue: 'right',
      },
      {
        path: 'title',
        kind: 'changed',
        leftValue: 'Left',
        rightValue: 'Right',
      },
    ]);
  });

  it('marks missing values as added or removed', () => {
    expect(createDifferenceEntries(undefined, { value: 1 })).toEqual([
      {
        path: 'value',
        kind: 'added',
        leftValue: undefined,
        rightValue: { value: 1 },
      },
    ]);

    expect(createDifferenceEntries({ value: 1 }, undefined)).toEqual([
      {
        path: 'value',
        kind: 'removed',
        leftValue: { value: 1 },
        rightValue: undefined,
      },
    ]);
  });

  it('wraps detail values with generated change entries only for changed rows', () => {
    expect(
      buildDetailValue(
        'Record title',
        'Model · 123',
        'changed',
        { title: 'Left' },
        { title: 'Right' },
      ),
    ).toMatchObject({
      title: 'Record title',
      subtitle: 'Model · 123',
      status: 'changed',
      changes: [
        {
          path: 'title',
          kind: 'changed',
          leftValue: 'Left',
          rightValue: 'Right',
        },
      ],
    });

    expect(
      buildDetailValue(
        'Record title',
        undefined,
        'unchanged',
        { title: 'Same' },
        { title: 'Same' },
      ),
    ).toMatchObject({
      changes: [],
    });
  });
});
