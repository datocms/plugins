import { describe, expect, it } from 'vitest';
import { buildConfirmOptions } from './confirm';
import { createCopy } from './copy';
import { makePlan } from './testing/fixtures';

const copy = createCopy('en');

describe('buildConfirmOptions', () => {
  it('builds the S13 confirm', () => {
    expect(buildConfirmOptions(makePlan(), copy)).toEqual({
      title: 'Replace 6 matches?',
      content:
        'Are you sure you want to replace "Acme" with "Globex" in 3 records? Records in models without draft/published change on your website right away.',
      choices: [
        { label: 'Yes, replace 6 matches', value: true, intent: 'negative' },
      ],
      cancel: { label: 'Cancel', value: false },
    });
  });

  it('names a single record and a single match', () => {
    const options = buildConfirmOptions(
      makePlan({
        matchCount: 1,
        recordCount: 1,
        singleRecord: { id: '7', title: 'About us' },
        liveRecordCount: 1,
      }),
      copy,
    );
    expect(options.title).toBe('Replace this match?');
    expect(options.choices[0].label).toBe('Yes, replace this match');
    expect(options.content).toBe(
      'Are you sure you want to replace "Acme" with "Globex" in "About us"? This record changes on your website right away.',
    );
  });

  it('falls back to "Record #id" for an untitled record', () => {
    const options = buildConfirmOptions(
      makePlan({
        recordCount: 1,
        singleRecord: { id: '7', title: null },
        liveRecordCount: 0,
      }),
      copy,
    );
    expect(options.content).toBe(
      'Are you sure you want to replace "Acme" with "Globex" in "Record #7"? Changes are saved as a draft and nothing gets published.',
    );
  });

  it('quotes a regular expression and cuts long strings', () => {
    const options = buildConfirmOptions(
      makePlan({
        regex: true,
        pattern: 'Acme(\\w+)',
        replacementText: `Globex$1 ${'x'.repeat(50)}`,
        liveRecordCount: 3,
      }),
      copy,
    );
    expect(options.content).toBe(
      `Are you sure you want to replace matches of /Acme(\\w+)/ with "Globex$1 ${'x'.repeat(30)}…" in 3 records? These records change on your website right away.`,
    );
  });

  it('uses the remove wording', () => {
    const literal = buildConfirmOptions(
      makePlan({
        verb: 'remove',
        pattern: '™',
        replacementText: '',
        matchCount: 3,
        liveRecordCount: 0,
      }),
      copy,
    );
    expect(literal.title).toBe('Remove 3 matches?');
    expect(literal.choices[0].label).toBe('Yes, remove 3 matches');
    expect(literal.content).toBe(
      'Are you sure you want to remove "™" from 3 records? Changes are saved as drafts and nothing gets published.',
    );

    const regex = buildConfirmOptions(
      makePlan({
        verb: 'remove',
        regex: true,
        pattern: '\\s+$',
        replacementText: '',
        matchCount: 1,
        recordCount: 1,
        singleRecord: { id: '9', title: 'Q3 report' },
        liveRecordCount: 0,
      }),
      copy,
    );
    expect(regex.title).toBe('Remove this match?');
    expect(regex.content).toBe(
      'Are you sure you want to remove matches of /\\s+$/ from "Q3 report"? Changes are saved as a draft and nothing gets published.',
    );
  });

  it('names slug changes first', () => {
    expect(
      buildConfirmOptions(makePlan({ slugMatchCount: 1 }), copy).content,
    ).toBe(
      'Are you sure you want to replace "Acme" with "Globex" in 3 records? 1 slug changes, which changes that record\'s URL. Records in models without draft/published change on your website right away.',
    );
    expect(
      buildConfirmOptions(makePlan({ slugMatchCount: 4 }), copy).content,
    ).toContain("4 slugs change, which changes those records' URLs.");
  });
});
