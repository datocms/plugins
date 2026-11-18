import { describe, expect, it, vi } from 'vitest';
import { buildConfirmOptions, singleRecordTitle } from './confirm';
import { createCopy } from './copy';
import { makePlan } from './testing/fixtures';

const copy = createCopy('en');

describe('buildConfirmOptions', () => {
  it('builds the S13 confirm', () => {
    expect(buildConfirmOptions(makePlan(), copy)).toEqual({
      title: 'Replace 6 matches?',
      content:
        "This replaces “Acme” with “Globex” in 3 records. Some of these records aren't saved as drafts, so they change on your website right away.",
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
        singleRecord: { id: '7' },
        liveRecordCount: 1,
      }),
      copy,
      'About us',
    );
    expect(options.title).toBe('Replace this match?');
    expect(options.choices[0].label).toBe('Yes, replace this match');
    expect(options.content).toBe(
      'This replaces “Acme” with “Globex” in “About us”. This record changes on your website right away.',
    );
  });

  it('counts the record when the host gives no title', () => {
    const options = buildConfirmOptions(
      makePlan({
        recordCount: 1,
        singleRecord: { id: '7' },
        liveRecordCount: 0,
      }),
      copy,
    );
    expect(options.content).toBe(
      'This replaces “Acme” with “Globex” in 1 record. Changes are saved as a draft and nothing gets published.',
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
      `This replaces matches of /Acme(\\w+)/ with “Globex$1 ${'x'.repeat(30)}…” in 3 records. These records change on your website right away.`,
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
      'This removes “™” from 3 records. Changes are saved as drafts and nothing gets published.',
    );

    const regex = buildConfirmOptions(
      makePlan({
        verb: 'remove',
        regex: true,
        pattern: '\\s+$',
        replacementText: '',
        matchCount: 1,
        recordCount: 1,
        singleRecord: { id: '9' },
        liveRecordCount: 0,
      }),
      copy,
      'Q3 report',
    );
    expect(regex.title).toBe('Remove this match?');
    expect(regex.content).toBe(
      'This removes matches of /\\s+$/ from “Q3 report”. Changes are saved as a draft and nothing gets published.',
    );
  });

  it('names slug changes first', () => {
    expect(
      buildConfirmOptions(makePlan({ slugMatchCount: 1 }), copy).content,
    ).toBe(
      "This replaces “Acme” with “Globex” in 3 records. 1 slug changes, which changes that record's URL. Some of these records aren't saved as drafts, so they change on your website right away.",
    );
    expect(
      buildConfirmOptions(makePlan({ slugMatchCount: 4 }), copy).content,
    ).toContain("4 slugs change, which changes those records' URLs.");
  });
});

describe('singleRecordTitle', () => {
  it('asks the host for the title of the one record a write changes', async () => {
    const loadItemPresentationInfo = vi.fn(async () => [
      {
        id: '7',
        title: 'About us',
        image: null,
        itemTypeId: 'page',
        status: 'draft' as const,
        currentVersionValid: true,
        publishedVersionValid: true,
        editPath: '/editor/item_types/page/items/7/edit',
      },
    ]);
    const plan = makePlan({ recordCount: 1, singleRecord: { id: '7' } });
    expect(await singleRecordTitle(plan, { loadItemPresentationInfo })).toBe(
      'About us',
    );
    expect(loadItemPresentationInfo).toHaveBeenCalledWith(['7']);
  });

  it('gives no title for many records, or when the host fails', async () => {
    const loadItemPresentationInfo = vi.fn(async () => {
      throw new Error('Host unavailable');
    });
    expect(
      await singleRecordTitle(makePlan(), { loadItemPresentationInfo }),
    ).toBeNull();
    expect(loadItemPresentationInfo).not.toHaveBeenCalled();
    expect(
      await singleRecordTitle(
        makePlan({ recordCount: 1, singleRecord: { id: '7' } }),
        { loadItemPresentationInfo },
      ),
    ).toBeNull();
  });
});
