import { describe, expect, it } from 'vitest';
import { summarizeLocaleOutcomes } from './ItemsDropdownUtils';
import type { LocaleOutcome } from './ItemsDropdownUtils';

const err = {
  code: 'rate_limit',
  source: 'provider',
  message: 'Rate limit reached.',
} as const;

describe('summarizeLocaleOutcomes', () => {
  it('flags a record when one locale is wholly dead, even if others succeeded', () => {
    const outcomes: LocaleOutcome[] = [
      { locale: 'it', translated: ['headline', 'subtitle'], failed: [] },
      {
        locale: 'fr',
        translated: [],
        failed: [
          { field: 'headline', error: err },
          { field: 'subtitle', error: err },
        ],
      },
    ];
    const summary = summarizeLocaleOutcomes(outcomes);
    expect(summary.hasDeadLocale).toBe(true);
    expect(summary.statusText).toContain('fr');
    expect(summary.statusText).toContain('0/2');
  });

  it('flags a record with a single failed field among successes', () => {
    const outcomes: LocaleOutcome[] = [
      {
        locale: 'fr',
        translated: ['headline'],
        failed: [{ field: 'subtitle', error: err }],
      },
    ];
    expect(summarizeLocaleOutcomes(outcomes).hasDeadLocale).toBe(true);
  });

  it('reports a clean run as clean', () => {
    const outcomes: LocaleOutcome[] = [
      { locale: 'fr', translated: ['headline'], failed: [] },
    ];
    const summary = summarizeLocaleOutcomes(outcomes);
    expect(summary.hasDeadLocale).toBe(false);
    expect(summary.statusText).toBeUndefined();
  });
});
