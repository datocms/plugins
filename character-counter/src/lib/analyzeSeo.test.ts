import { describe, expect, it } from 'vitest';
import {
  analyzeSeoValue,
  getLengthStatus,
  readLengthLimit,
} from './analyzeSeo';

describe('readLengthLimit', () => {
  it('keeps numeric bounds only', () => {
    expect(readLengthLimit({ min: 10, max: 60 })).toEqual({ min: 10, max: 60 });
    expect(readLengthLimit({ max: 160 })).toEqual({ max: 160 });
    expect(readLengthLimit({ min: '5' })).toEqual({});
    expect(readLengthLimit(undefined)).toEqual({});
    expect(readLengthLimit(null)).toEqual({});
  });
});

describe('getLengthStatus', () => {
  it('flags counts above max', () => {
    expect(getLengthStatus(61, { max: 60 })).toBe('over');
    expect(getLengthStatus(60, { max: 60 })).toBe('ok');
  });

  it('flags non-empty counts below min', () => {
    expect(getLengthStatus(5, { min: 10 })).toBe('under');
    expect(getLengthStatus(0, { min: 10 })).toBe('ok');
  });

  it('accepts anything without a limit', () => {
    expect(getLengthStatus(1000, {})).toBe('ok');
  });
});

describe('analyzeSeoValue', () => {
  it('counts title and description against their validators', () => {
    const result = analyzeSeoValue(
      { title: 'a'.repeat(65), description: 'b'.repeat(120), image: null },
      { title_length: { max: 60 }, description_length: { min: 50, max: 160 } },
    );

    expect(result.title).toEqual({
      count: 65,
      limit: { max: 60 },
      status: 'over',
    });
    expect(result.description).toEqual({
      count: 120,
      limit: { min: 50, max: 160 },
      status: 'ok',
    });
  });

  it('handles null values and missing validators', () => {
    expect(analyzeSeoValue(null, {})).toEqual({
      title: { count: 0, limit: {}, status: 'ok' },
      description: { count: 0, limit: {}, status: 'ok' },
    });
    expect(analyzeSeoValue({ title: null }, {}).title.count).toBe(0);
  });
});
