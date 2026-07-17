/**
 * End-to-end pure-pipeline test: buildPlan → collectUnitFlags → conform →
 * assembleRecordPayload → checkLocalePreservation. No provider, no CMA. Proves
 * the six pure pieces compose — unit keys and field paths line up — and locks
 * the Written/Blocked behavior the live orchestration will wire together.
 */
import { describe, expect, it } from 'vitest';
import { buildPlan } from './buildPlan';
import { collectUnitFlags, type ReconstructedCell } from './collectUnitFlags';
import { conform } from './conform';
import { assembleRecordPayload, type WrittenLocalePayload } from './assemblePayload';
import { checkLocalePreservation } from './checks/localePreservation';
import type { BuildPlanInput, PlanField, PlanRecord } from './buildPlanTypes';

const field = (apiKey: string, over: Partial<PlanField> = {}): PlanField => ({
  id: apiKey,
  apiKey,
  fieldType: 'string',
  isLocalized: true,
  validators: {},
  ...over,
});

// 'en' and 'it' already exist on the record; 'de' will be a brand-new locale.
const record: PlanRecord = {
  id: 'r1',
  itemTypeId: 'article',
  meta: { current_version: 'v1' },
  title: { en: 'Hello', it: 'Ciao-vecchio' },
  body: { en: 'Hello world', it: 'Vecchio mondo' },
  brand: { en: 'Acme', it: 'Acme' },
};

const input: BuildPlanInput = {
  records: [record],
  fieldsByItemType: new Map([
    ['article', [field('title', { validators: { required: {} } as never }), field('body'), field('brand')]],
  ]),
  allLocalesRequiredByItemType: new Map(),
  policy: { excludedTokens: ['brand'], copyTokens: [] },
  fromLocale: 'en',
  toLocales: ['it', 'de'],
  policyDigest: 'digest',
};

describe('plan/apply pure pipeline', () => {
  it('writes a clean locale and blocks a locale with an invariant violation', () => {
    const plan = buildPlan(input);

    // Reconstructed output: 'it' is clean; 'de' (a new locale) came back with a
    // BLANK required title — an invariant violation that must block 'de'.
    const results = new Map<string, ReconstructedCell>([
      ['r1|title|it', { translatedValue: 'Ciao' }],
      ['r1|body|it', { translatedValue: 'Ciao mondo' }],
      ['r1|title|de', { translatedValue: '' }],
      ['r1|body|de', { translatedValue: 'Hallo Welt' }],
      ['r1|brand|de', { translatedValue: 'Acme' }],
    ]);

    const flags = collectUnitFlags(plan, (r, f, l) => results.get(`${r}|${f}|${l}`));
    const outcomes = conform(plan, flags);

    const itOutcome = outcomes.find((o) => o.toLocale === 'it');
    const deOutcome = outcomes.find((o) => o.toLocale === 'de');
    expect(itOutcome?.bucket).toBe('written');
    expect(deOutcome?.bucket).toBe('blocked');
    expect(deOutcome?.reasons.map((x) => x.code)).toContain('required-blank');

    // Assemble the single items.update body from ONLY the written locales.
    const written: WrittenLocalePayload[] = outcomes
      .filter((o) => o.bucket === 'written')
      .map((o) => ({
        toLocale: o.toLocale,
        fields: Object.fromEntries(
          plan.records[0].units
            .find((u) => u.toLocale === o.toLocale)!
            .cells.map((c) => [c.fieldPath, results.get(`r1|${c.fieldPath}|${o.toLocale}`)?.translatedValue]),
        ),
      }));

    const payload = assembleRecordPayload(record, written);
    // 'it' written: title/body carry en (preserved) + it; 'de' omitted (blocked).
    expect(payload.title).toEqual({ en: 'Hello', it: 'Ciao' });
    expect(payload.body).toEqual({ en: 'Hello world', it: 'Ciao mondo' });
    expect(payload.brand).toBeUndefined(); // excluded on existing locale 'it'

    // Final safety gate: the assembled payload drops no pre-existing locale.
    for (const [fieldPath, value] of Object.entries(payload)) {
      const cell = plan.records[0].units
        .find((u) => u.toLocale === 'it')!
        .cells.find((c) => c.fieldPath === fieldPath);
      expect(
        checkLocalePreservation({ outgoing: value, preservedLocales: cell?.expected.preservedLocales ?? [] }),
      ).toBeNull();
    }
  });
});
