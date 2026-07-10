import { describe, expect, it } from 'vitest';
import { isExportEnabled } from './exportGating';

const err = { code: 'rate_limit', source: 'provider', message: 'x' } as const;

describe('isExportEnabled', () => {
  it('is disabled while running', () =>
    expect(isExportEnabled({ kind: 'running' }, 5)).toBe(false));
  it('is disabled while paused', () =>
    expect(isExportEnabled({ kind: 'paused', reason: err, attempt: 1 }, 5)).toBe(false));
  it('is enabled once completed', () =>
    expect(isExportEnabled({ kind: 'completed' }, 5)).toBe(true));
  it('is enabled once cancelled', () =>
    expect(isExportEnabled({ kind: 'cancelled' }, 5)).toBe(true));
  it('is disabled when nothing was processed', () =>
    expect(isExportEnabled({ kind: 'completed' }, 0)).toBe(false));
});
