import { describe, expect, it } from 'vitest';
import type { DisabledReason, NoResultsView } from '../contract';
import { createCopy, quote, whereLabel, whereName } from './copy';

const copy = createCopy('en');

describe('counts', () => {
  it('uses whole-string plurals and the locale for digits', () => {
    expect(copy.matches(1)).toBe('1 match');
    expect(copy.matches(1200)).toBe('1,200 matches');
    expect(copy.records(1)).toBe('1 record');
    expect(copy.records(0)).toBe('0 records');
    expect(createCopy('de').matches(1200)).toBe('1.200 matches');
  });

  it('falls back to English digits for an unknown locale', () => {
    expect(createCopy('not a locale!').matches(1200)).toBe('1,200 matches');
  });

  it('quotes strings, marks line breaks and tabs, and cuts at 40', () => {
    expect(quote('Acme')).toBe('"Acme"');
    expect(quote('a\r\nb\tc')).toBe('"a↵b→c"');
    expect(quote('x'.repeat(40))).toBe(`"${'x'.repeat(40)}"`);
    expect(quote('x'.repeat(41))).toBe(`"${'x'.repeat(39)}…"`);
  });
});

describe('meta', () => {
  it('covers every kind', () => {
    expect(copy.meta({ kind: 'none' })).toBeNull();
    expect(copy.meta({ kind: 'noMatches' })).toBe('No matches');
    expect(
      copy.meta({ kind: 'found', matches: 1, records: 1, capped: false }),
    ).toBe('1 match in 1 record');
    expect(
      copy.meta({ kind: 'found', matches: 3, records: 1, capped: false }),
    ).toBe('3 matches in 1 record');
    expect(
      copy.meta({ kind: 'found', matches: 124, records: 38, capped: false }),
    ).toBe('124 matches in 38 records');
    expect(
      copy.meta({ kind: 'found', matches: 10000, records: 2310, capped: true }),
    ).toBe('10,000+ matches in 2,310 records');
    expect(
      copy.meta({
        kind: 'willChange',
        changing: 118,
        found: 124,
        verb: 'replace',
      }),
    ).toBe('118 of 124 matches will change');
    expect(
      copy.meta({ kind: 'willChange', changing: 2, found: 3, verb: 'remove' }),
    ).toBe('2 of 3 matches will be removed');
    expect(
      copy.meta({ kind: 'willChange', changing: 0, found: 3, verb: 'replace' }),
    ).toBe('No matches will change');
    expect(
      copy.meta({ kind: 'willChange', changing: 0, found: 3, verb: 'remove' }),
    ).toBe('No matches will be removed');
    expect(
      copy.meta({
        kind: 'runStopped',
        verb: 'replace',
        replacedMatches: 48,
        plannedMatches: 121,
      }),
    ).toBe('48 of 121 matches replaced');
    expect(
      copy.meta({
        kind: 'runStopped',
        verb: 'remove',
        replacedMatches: 0,
        plannedMatches: 1,
      }),
    ).toBe('0 of 1 match removed');
  });

  it('reports a finished run', () => {
    const finished = (
      replacedMatches: number,
      skippedRecords: number,
      failedRecords: number,
      verb: 'replace' | 'remove' = 'replace',
      publishedRecords = 0,
    ) =>
      copy.meta({
        kind: 'runFinished',
        verb,
        replacedMatches,
        skippedRecords,
        failedRecords,
        publishedRecords,
      });
    expect(finished(121, 0, 0)).toBe('121 matches replaced');
    expect(finished(1, 0, 0)).toBe('1 match replaced');
    expect(finished(0, 0, 3)).toBe('No matches replaced, 3 records failed');
    expect(finished(120, 1, 0)).toBe('120 matches replaced, 1 record skipped');
    expect(finished(119, 0, 2)).toBe('119 matches replaced, 2 records failed');
    expect(finished(115, 3, 2)).toBe(
      '115 matches replaced, 3 records skipped, 2 failed',
    );
    expect(finished(6, 0, 0, 'remove')).toBe('6 matches removed');
    expect(finished(36, 0, 0, 'replace', 9)).toBe(
      '36 matches replaced, 9 records published',
    );
    expect(finished(36, 1, 0, 'replace', 1)).toBe(
      '36 matches replaced, 1 record skipped, 1 record published',
    );
  });
});

describe('publishing', () => {
  it('labels the button and the progress', () => {
    expect(copy.publishLabel(1)).toBe('Publish 1 record');
    expect(copy.publishLabel(1200)).toBe('Publish 1,200 records');
    expect(copy.publishProgress(3, 9)).toBe('3 of 9 records published');
  });

  it('asks before publishing, naming what stays unpublished', () => {
    expect(
      copy.publishConfirm({ token: 't', recordCount: 9, heldCount: 0 }),
    ).toEqual({
      title: 'Publish 9 records?',
      content:
        'Only the replaced text goes live, as these records had no other unpublished changes.',
      choice: 'Yes, publish 9 records',
    });
    const one = copy.publishConfirm({
      token: 't',
      recordCount: 1,
      heldCount: 2,
    });
    expect(one.title).toBe('Publish this record?');
    expect(one.choice).toBe('Yes, publish this record');
    expect(one.content).toBe(
      "Only the replaced text goes live, as this record had no other unpublished changes. 2 other replaced records stay unpublished, as publishing them would also publish changes that aren't part of this replacement.",
    );
  });

  it('explains every record left unpublished', () => {
    expect(copy.publishReason({ kind: 'held', reason: 'other_changes' })).toBe(
      'Not published, as it already had other unpublished changes.',
    );
    expect(
      copy.publishReason({ kind: 'held', reason: 'never_published' }),
    ).toBe('Not published, as it had never been published.');
    expect(copy.publishReason({ kind: 'skipped', reason: 'changed' })).toBe(
      'Not published, as it was edited after the replacement.',
    );
    expect(
      copy.publishReason({
        kind: 'failed',
        reason: 'validation',
        retryable: false,
        detail: { fieldLabel: 'Published on', code: 'required' },
      }),
    ).toBe('Couldn\'t publish, as "Published on" can\'t be empty.');
    expect(copy.publishReason({ kind: 'ready' })).toBeNull();
    expect(copy.publishReason({ kind: 'published' })).toBeNull();
  });
});

describe('primary', () => {
  it('labels the slot', () => {
    expect(copy.primaryLabel('replace', 1)).toBe('Replace 1 match');
    expect(copy.primaryLabel('remove', 1200)).toBe('Remove 1,200 matches');
    expect(copy.primaryIdleLabel('remove')).toBe('Remove');
  });

  it('explains every disabled reason', () => {
    const reasons: Record<DisabledReason, string> = {
      no_matches: 'You cannot remove anything until the search finds matches',
      search_running:
        'You cannot remove right now as the search is still running',
      press_enter: 'You cannot remove until you press Enter to search',
      invalid_pattern: 'You cannot remove as the pattern is not valid',
      no_replacement:
        'You cannot replace until you type a replacement or turn on Replace with nothing',
      invalid_replacement: 'You cannot replace until the replacement is fixed',
      nothing_selected: 'You cannot remove as no matches are selected',
      nothing_changes: 'You cannot replace as nothing would change',
      replacing: 'You cannot remove right now as a replacement is in progress',
    };
    for (const [reason, text] of Object.entries(reasons)) {
      expect(copy.disabledReason(reason as DisabledReason, 'remove')).toBe(
        text,
      );
    }
  });
});

describe('progress', () => {
  it('counts records', () => {
    expect(copy.searchProgress(0, null)).toBe('Searching…');
    expect(copy.searchProgress(1, null)).toBe('1 record searched');
    expect(copy.searchProgress(1200, null)).toBe('1,200 records searched');
    expect(copy.searchProgress(1200, 3400)).toBe(
      '1,200 of 3,400 records searched',
    );
    expect(copy.replaceProgress(0, 1)).toBe('0 of 1 record processed');
    expect(copy.replaceProgress(1, 3)).toBe('1 of 3 records processed');
  });

  it('rounds the time left to minutes', () => {
    expect(copy.timeLeft(3)).toBe('Less than a minute left');
    expect(copy.timeLeft(59)).toBe('Less than a minute left');
    expect(copy.timeLeft(60)).toBe('About a minute left');
    expect(copy.timeLeft(89)).toBe('About a minute left');
    expect(copy.timeLeft(90)).toBe('About 2 minutes left');
    expect(copy.timeLeft(170)).toBe('About 3 minutes left');
    expect(createCopy('de').timeLeft(60 * 1500)).toBe(
      'About 1.500 minutes left',
    );
  });
});

describe('results', () => {
  it('labels rows, checkboxes and links', () => {
    expect(copy.recordTitle(null, '42')).toBe('Record #42');
    expect(copy.recordTitle('  ', '42')).toBe('Record #42');
    expect(copy.recordCheckbox('About us')).toBe('Select "About us"');
    expect(copy.matchCheckbox('Title', 'en')).toBe(
      'Select this match in Title (en)',
    );
    expect(copy.matchCheckbox('Slug', null)).toBe('Select this match in Slug');
    // Fields with 2+ matches number their checkboxes, like the lines' names.
    expect(copy.matchCheckbox('Body', 'en', 1, 3)).toBe(
      'Select match 2 in Body (en)',
    );
    expect(copy.matchCheckbox('SEO › Description', null, 0, 2)).toBe(
      'Select match 1 in SEO › Description',
    );
    expect(copy.matchCheckbox('Title', 'en', 0, 1)).toBe(
      'Select this match in Title (en)',
    );
    expect(copy.showMore(1)).toBe('Show 1 more match');
    expect(copy.showMore(20)).toBe('Show 20 more matches');
  });

  it('writes the record meta after the title', () => {
    expect(copy.recordMeta('Article', 1)).toBe('Article · 1 match');
    expect(copy.recordMeta('Blog post', 1200)).toBe(
      'Blog post · 1,200 matches',
    );
  });

  it('writes where-cells as plain text, every segment kept', () => {
    const plain = (label: string) => label.replace(/\u00a0/g, ' ');
    expect(plain(whereLabel(['Title'], 'en'))).toBe('Title · en');
    expect(plain(whereLabel(['SEO', 'Description'], null))).toBe(
      'SEO › Description',
    );
    expect(plain(whereLabel(['A', 'B', 'C', 'D', 'E'], 'it'))).toBe(
      'A › B › C › D › E · it',
    );
  });

  it('wraps where-cells only after "›", keeping the locale with the last segment', () => {
    const nb = '\u00a0';
    expect(whereLabel(['Content', 'Hero', 'Heading'], 'en')).toBe(
      `Content${nb}› Hero${nb}› Heading${nb}·${nb}en`,
    );
    expect(whereLabel(['Call to action'], 'en')).toBe(
      `Call to action${nb}·${nb}en`,
    );
  });

  it('names every match line, numbering only fields with 2+ matches', () => {
    expect(whereName(['Title'], 'en', 0, 1)).toBe('Title, en');
    expect(whereName(['Body'], 'en', 1, 4)).toBe('Body, en, match 2');
    expect(whereName(['SEO', 'Description'], null, 0, 2)).toBe(
      'SEO › Description, match 1',
    );
  });

  it('writes every failure reason', () => {
    const failed = (
      code: 'length' | 'format' | 'unique' | 'required' | 'other',
      fieldLabel: string | null = 'Title',
    ) =>
      copy.statusReason({
        kind: 'failed',
        reason: 'validation',
        retryable: false,
        detail: { fieldLabel, code },
      });
    expect(failed('length')).toBe(
      'The new value is too long or too short for "Title".',
    );
    expect(failed('format')).toBe(
      'The new value doesn\'t have the format "Title" requires.',
    );
    expect(failed('unique')).toBe('The new value must be unique in "Title".');
    expect(failed('required')).toBe('"Title" can\'t be empty.');
    expect(failed('other')).toBe(
      'The new value doesn\'t pass the validations of "Title".',
    );
    expect(failed('length', null)).toBe(
      "The new value doesn't pass the field's validations.",
    );
    expect(
      copy.statusReason({
        kind: 'failed',
        reason: 'network',
        retryable: true,
        detail: null,
      }),
    ).toBe("Couldn't save this record. Try again.");
    expect(copy.statusReason({ kind: 'untouched' })).toBeNull();
    expect(
      copy.statusReason({ kind: 'replaced', replacedMatches: 2 }),
    ).toBeNull();
  });
});

describe('lines above the card', () => {
  it('explains pattern and replacement problems', () => {
    expect(copy.patternProblem({ code: 'invalid_regex', cause: null })).toBe(
      'Pattern must be a valid regular expression',
    );
    expect(copy.patternProblem({ code: 'too_slow' })).toBe(
      'Pattern takes too long to run, so try a simpler one',
    );
    expect(copy.replacementProblem({ code: 'context_token' })).toBe(
      "Replacement can't use $` or $'",
    );
    expect(
      copy.replacementWarning({
        code: 'group_out_of_range',
        token: '$1',
        groupCount: 0,
      }),
    ).toBe('Replacement uses $1, but the pattern has no groups');
    expect(
      copy.replacementWarning({
        code: 'group_out_of_range',
        token: '$2',
        groupCount: 1,
      }),
    ).toBe('Replacement uses $2, but the pattern only has 1 group');
    expect(
      copy.replacementWarning({
        code: 'group_out_of_range',
        token: '$<year>',
        groupCount: 2,
      }),
    ).toBe('Replacement uses $<year>, but the pattern only has 2 groups');
    expect(copy.replacementWarning({ code: 'slug_format', count: 1 })).toBe(
      'Slugs only allow lowercase letters, numbers, hyphens and underscores, so 1 slug change will probably fail',
    );
    expect(copy.replacementWarning({ code: 'slug_format', count: 4 })).toBe(
      'Slugs only allow lowercase letters, numbers, hyphens and underscores, so 4 slug changes will probably fail',
    );
  });

  it('writes the notes', () => {
    // Searching again reads on from where the capped search stopped, so a
    // replacement that matches the search again doesn't hold the rest back.
    expect(
      copy.note({ kind: 'capped', selfMatch: true, continued: false }),
    ).toBe(
      'Showing the first 10,000 matches. Replace them, then search again for the rest.',
    );
    expect(
      copy.note({ kind: 'capped', selfMatch: false, continued: true }),
    ).toBe(
      'Showing the next 10,000 matches. Replace them, then search again for the rest.',
    );
    expect(
      copy.note({ kind: 'searchStopped', searched: 1200, total: null }),
    ).toBe(
      'Search stopped after 1,200 records, so some matches may be missing.',
    );
  });

  it('writes every callout', () => {
    const failed = (
      count: number,
      singleReason: 'validation' | 'permission' | 'network' | 'unknown' | null,
      retryable = false,
    ) =>
      copy.callout({ kind: 'recordsFailed', count, retryable, singleReason });
    expect(failed(1, null, true)).toEqual({
      tone: 'danger',
      text: "Couldn't update 1 record. The reason is under it.",
      action: 'retryRecords',
    });
    expect(failed(2, 'validation').text).toBe(
      "Couldn't update 2 records, as the new values don't pass their field validations.",
    );
    expect(failed(1, 'validation')).toEqual({
      tone: 'danger',
      text: "Couldn't update 1 record, as the new value doesn't pass its field validations.",
      action: null,
    });
    expect(failed(1, 'permission').text).toBe(
      "Couldn't update 1 record, as your role can't edit it.",
    );
    expect(failed(3, 'permission').text).toBe(
      "Couldn't update 3 records, as your role can't edit them.",
    );
    expect(failed(3, 'network', true).text).toBe(
      "Couldn't update 3 records, as DatoCMS didn't respond.",
    );

    expect(
      copy.callout({ kind: 'recordsSkipped', count: 1, allStale: true }),
    ).toEqual({
      tone: 'warning',
      text: '1 record changed after the search and was skipped. Search again to include it.',
      action: null,
    });
    expect(
      copy.callout({ kind: 'recordsSkipped', count: 1, allStale: false }).text,
    ).toBe('1 record was skipped. The reason is under it.');
    expect(
      copy.callout({ kind: 'recordsSkipped', count: 4, allStale: false }).text,
    ).toBe('4 records were skipped. The reason is under each one.');

    const models = (names: string[]) =>
      copy.callout({
        kind: 'modelsFailed',
        modelNames: names,
        retryable: true,
      });
    expect(models(['Author'])).toEqual({
      tone: 'warning',
      text: 'Couldn\'t search the "Author" model.',
      action: 'retryModels',
    });
    // Capped results: no "Try again", searching again reads them.
    expect(
      copy.callout({
        kind: 'modelsFailed',
        modelNames: ['Author', 'Page'],
        retryable: false,
      }),
    ).toEqual({
      tone: 'warning',
      text: 'Couldn\'t search the "Author" and "Page" models. Searching again reads them once more.',
      action: null,
    });
    expect(models(['A', 'B', 'C']).text).toBe(
      'Couldn\'t search the "A", "B" and "C" models.',
    );
    expect(models(['A', 'B', 'C', 'D']).text).toBe("Couldn't search 4 models.");
  });
});

describe('no results and pane states', () => {
  const view = (partial: Partial<NoResultsView>): NoResultsView => ({
    followsRun: false,
    continued: false,
    runVerb: 'replace',
    caseSensitive: false,
    wholeWord: false,
    regex: false,
    filteredModelName: null,
    otherModelsHaveMatches: false,
    ...partial,
  });

  it('titles no results with the searched pattern, quoted like the confirm', () => {
    expect(copy.noResultsTitle(view({}), 'Acme Corp')).toBe(
      'No matches for "Acme Corp"',
    );
    expect(copy.noResultsTitle(view({}), `a\tb\n${'x'.repeat(60)}`)).toBe(
      `No matches for "a→b↵${'x'.repeat(35)}…"`,
    );
    expect(copy.noResultsTitle(view({ regex: true }), 'Acme\\d+')).toBe(
      'No matches for /Acme\\d+/',
    );
  });

  it("closes a run with the run's verb", () => {
    expect(copy.noResultsTitle(view({ followsRun: true }), 'Acme')).toBe(
      'Every match has been replaced',
    );
    expect(
      copy.noResultsTitle(
        view({ followsRun: true, runVerb: 'remove' }),
        'Acme',
      ),
    ).toBe('Every match has been removed');
  });

  it('scopes the title to the chosen model when the filter hides matches elsewhere', () => {
    const hidden = { filteredModelName: 'Page', otherModelsHaveMatches: true };
    expect(copy.noResultsTitle(view(hidden), 'Acme')).toBe(
      'No matches for "Acme" in "Page"',
    );
    // Even right after a run: matches remain behind the filter.
    expect(
      copy.noResultsTitle(view({ ...hidden, followsRun: true }), 'Acme'),
    ).toBe('No matches for "Acme" in "Page"');
    expect(copy.noResultsLine(view({ ...hidden, followsRun: true }))).toBe(
      'Choose All models to see the others.',
    );
    // A filter that hides nothing changes nothing.
    expect(
      copy.noResultsTitle(
        view({ filteredModelName: 'Page', followsRun: true }),
        'Acme',
      ),
    ).toBe('Every match has been replaced');
  });

  it('names only what narrows the search', () => {
    expect(copy.noResultsLine(view({ followsRun: true, regex: true }))).toBe(
      'Type something else to find.',
    );
    expect(
      copy.noResultsLine(
        view({ filteredModelName: 'Article', otherModelsHaveMatches: true }),
      ),
    ).toBe('Choose All models to see the others.');
    expect(
      copy.noResultsLine(
        view({ caseSensitive: true, wholeWord: true, regex: true }),
      ),
    ).toBe(
      'Consider broadening your search: turn off Match case and Match whole word, check the regular expression, or try different keywords.',
    );
    expect(copy.noResultsLine(view({ wholeWord: true }))).toBe(
      'Consider broadening your search: turn off Match whole word, or try different keywords.',
    );
    expect(copy.noResultsLine(view({}))).toBe(
      'Check the spelling, or try different keywords.',
    );
  });

  it('writes the pane states', () => {
    expect(copy.paneState({ kind: 'unavailable', cause: 'no_models' })).toEqual(
      {
        icon: 'ban',
        title: 'Permission denied',
        line: "Your role can't edit records in any model this plugin can search.",
      },
    );
    expect(copy.paneState({ kind: 'unavailable', cause: 'token' })).toEqual({
      icon: 'error',
      title: "Couldn't access your content",
      line: 'This plugin needs access to your API token. Ask a project admin to grant it in the plugin settings.',
    });
    expect(copy.paneState({ kind: 'bootFailed', cause: 'unknown' }).line).toBe(
      'Something went wrong while loading your models and fields.',
    );
    expect(
      copy.paneState({ kind: 'searchFailed', cause: 'unknown' }).line,
    ).toBe('Something went wrong while reading your records.');
  });
});

describe('model filter and live region', () => {
  it('counts options', () => {
    expect(copy.filterTrigger(null)).toBe('All models');
    expect(copy.filterTrigger({ name: 'Article' })).toBe('Article');
    expect(copy.optionCount(96, false)).toBe('96');
    expect(copy.optionCount(0, true)).toBe('0+');
    expect(copy.optionCount(null, true)).toBe('—');
    expect(copy.optionCountSuffix(1)).toBe(', 1 match');
    expect(copy.optionCountSuffix(0)).toBe(', no matches');
    expect(copy.optionCountSuffix(null)).toBe(", couldn't be searched");
  });

  it('announces settled searches', () => {
    expect(
      copy.announceSettled({
        matches: 10000,
        records: 12,
        capped: true,
        stopped: true,
      }),
    ).toBe('Search stopped. 10,000+ matches in 12 records');
  });
});
