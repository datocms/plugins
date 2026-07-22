import { describe, expect, it } from 'vitest';
import { footerPrimary } from './footerState';

const err = { code: 'rate_limit', source: 'provider', message: 'x' } as const;

describe('footerPrimary', () => {
  it('is hidden while running', () =>
    expect(
      footerPrimary({ kind: 'running' }, { isPublishing: false }).isVisible,
    ).toBe(false));

  it('is hidden while paused', () =>
    expect(
      footerPrimary(
        { kind: 'paused', reason: err, attempt: 1 },
        { isPublishing: false },
      ).isVisible,
    ).toBe(false));

  it('is a "Close" button once completed', () => {
    const primary = footerPrimary({ kind: 'completed' }, { isPublishing: false });
    expect(primary.isVisible).toBe(true);
    expect(primary.label).toBe('Close');
    expect(primary.isDisabled).toBe(false);
  });

  it('is visible once cancelled', () =>
    expect(
      footerPrimary({ kind: 'cancelled' }, { isPublishing: false }).isVisible,
    ).toBe(true));

  it('is disabled while a post-run publish is in flight', () =>
    expect(
      footerPrimary({ kind: 'completed' }, { isPublishing: true }).isDisabled,
    ).toBe(true));
});
