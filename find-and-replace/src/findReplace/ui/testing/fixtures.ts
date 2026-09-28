import type {
  BootView,
  DisabledReason,
  FieldView,
  FindReplaceEvent,
  FindReplaceSnapshot,
  MatchDisplay,
  MatchView,
  PlanFacts,
  PrimaryView,
  PublishOffer,
  RecordPublishStatus,
  RecordRunStatus,
  RecordView,
  ReplaceVerb,
  RunTotals,
} from '../../contract';
import { createFakeController, type FakeController } from './fakeController';

/**
 * Snapshot builders for every state of the page (SPEC §3, S1–S23, plus the
 * publish step S24–S25), shared by
 * the UI tests and the harness state gallery. The numbers follow the
 * wireframes; they are plausible, not computed (the UI never computes them).
 */

// ── Builders ────────────────────────────────────────────────────────────────

type MatchInit = {
  key: string;
  text: string;
  before?: string;
  after?: string;
  beforeTruncated?: boolean;
  afterTruncated?: boolean;
  included?: boolean;
  selectable?: boolean;
  display?: MatchDisplay;
};

export function makeMatch(init: MatchInit): MatchView {
  return {
    key: init.key,
    before: init.before ?? '',
    beforeTruncated: init.beforeTruncated ?? false,
    text: init.text,
    after: init.after ?? '',
    afterTruncated: init.afterTruncated ?? false,
    included: init.included ?? true,
    selectable: init.selectable ?? false,
    display: init.display ?? { kind: 'highlight' },
  };
}

type FieldInit = {
  key: string;
  path: ReadonlyArray<string>;
  locale?: string | null;
  changesUrl?: boolean;
  matches: ReadonlyArray<MatchView>;
};

export function makeField(init: FieldInit): FieldView {
  return {
    key: init.key,
    path: init.path,
    locale: init.locale ?? null,
    changesUrl: init.changesUrl ?? false,
    matches: init.matches,
  };
}

type RecordInit = {
  modelId: string;
  modelName: string;
  recordId: string;
  title: string | null;
  fields: ReadonlyArray<FieldView>;
  inclusion?: RecordView['inclusion'];
  selectable?: boolean;
  status?: RecordRunStatus;
  publish?: RecordPublishStatus;
};

export function makeRecord(init: RecordInit): RecordView {
  let matchCount = 0;
  for (const field of init.fields) {
    matchCount += field.matches.length;
  }
  return {
    key: `${init.modelId}:${init.recordId}`,
    recordId: init.recordId,
    modelId: init.modelId,
    modelName: init.modelName,
    title: init.title,
    matchCount,
    inclusion: init.inclusion ?? 'all',
    selectable: init.selectable ?? false,
    status: init.status ?? { kind: 'untouched' },
    publish: init.publish ?? { kind: 'none' },
    fields: init.fields,
  };
}

export function makeTotals(partial: Partial<RunTotals> = {}): RunTotals {
  return {
    replacedMatches: 0,
    replacedRecords: 0,
    skippedRecords: 0,
    staleSkippedRecords: 0,
    failedRecords: 0,
    retryableFailedRecords: 0,
    notAttemptedRecords: 0,
    plannedRecords: 0,
    plannedMatches: 0,
    ...partial,
  };
}

export function makePlan(partial: Partial<PlanFacts> = {}): PlanFacts {
  return {
    token: 'plan-1',
    verb: 'replace',
    matchCount: 6,
    recordCount: 3,
    singleRecord: null,
    liveRecordCount: 1,
    slugMatchCount: 0,
    pattern: 'Acme',
    regex: false,
    replacementText: 'Globex',
    ...partial,
  };
}

export function disabledPrimary(
  reason: DisabledReason,
  partial: { verb?: ReplaceVerb; count?: number; busy?: boolean } = {},
): PrimaryView {
  return {
    kind: 'replace',
    verb: partial.verb ?? 'replace',
    count: partial.count ?? 0,
    enabled: false,
    busy: partial.busy ?? false,
    reason,
  };
}

export function runEndedEvent(
  partial: Partial<Extract<FindReplaceEvent, { type: 'runEnded' }>> = {},
): Extract<FindReplaceEvent, { type: 'runEnded' }> {
  return {
    type: 'runEnded',
    stopped: false,
    verb: 'replace',
    pass: makeTotals(),
    allFailedCause: null,
    ...partial,
  };
}

/** S2: ready, empty query. Every other snapshot starts from here. */
export function idleSnapshot(): FindReplaceSnapshot {
  return {
    version: 1,
    find: { pattern: '', caseSensitive: false, wholeWord: false, regex: false },
    replace: { text: '', remove: false },
    verb: null,
    findRow: {
      enabled: true,
      showClear: false,
      showEraser: false,
      enterToSearch: false,
      awaitingEnter: false,
    },
    search: {
      phase: 'idle',
      resultsId: 0,
      showProgress: false,
      progress: { searched: 0, total: null },
      capped: false,
      stopped: false,
      failedModels: [],
      patternProblem: null,
      failure: null,
      followsRun: false,
      continued: false,
      secondsLeft: null,
    },
    replacementCheck: { problem: null, warnings: [] },
    modelFilter: {
      visible: false,
      enabled: true,
      selected: null,
      options: [],
      allMatchCount: 0,
      partial: false,
    },
    primary: disabledPrimary('no_matches'),
    meta: { kind: 'none' },
    body: 'idle',
    note: null,
    callouts: [],
    noResults: null,
    selection: { ui: 'hidden', all: 'all' },
    records: [],
    run: {
      phase: 'none',
      verb: 'replace',
      progress: { done: 0, total: 0, updated: 0 },
      totals: null,
    },
    plan: null,
    publish: { phase: 'none', progress: { done: 0, total: 0, published: 0 } },
    hasManualSelection: false,
  };
}

// ── The "Acme" result set (9 matches in 4 records, 2 models) ────────────────

const HIGHLIGHT: MatchDisplay = { kind: 'highlight' };

function acmeLaunches(): RecordView {
  return makeRecord({
    modelId: 'article',
    modelName: 'Article',
    recordId: 'launch',
    title: 'Acme launches a new widget',
    fields: [
      makeField({
        key: 'launch:title:en',
        path: ['Title'],
        locale: 'en',
        matches: [
          makeMatch({
            key: 'launch:title:en:0',
            text: 'Acme',
            after: ' launches a new widget',
          }),
        ],
      }),
      makeField({
        key: 'launch:title:it',
        path: ['Title'],
        locale: 'it',
        matches: [
          makeMatch({
            key: 'launch:title:it:0',
            text: 'Acme',
            after: ' lancia un nuovo widget',
          }),
        ],
      }),
      makeField({
        key: 'launch:body:en',
        path: ['Body'],
        locale: 'en',
        matches: [
          makeMatch({
            key: 'launch:body:en:0',
            before: 'We sat down with the team: the new widget, said the ',
            beforeTruncated: true,
            text: 'Acme',
            after: ' CEO, ships in May. The team\nbehind it spent two',
            afterTruncated: true,
          }),
        ],
      }),
    ],
  });
}

function brandGuidelines(): RecordView {
  return makeRecord({
    modelId: 'article',
    modelName: 'Article',
    recordId: 'brand',
    title: 'Brand guidelines',
    fields: [
      makeField({
        key: 'brand:title:en',
        path: ['Title'],
        locale: 'en',
        matches: [
          makeMatch({
            key: 'brand:title:en:0',
            text: 'ACME',
            after: ' brand guidelines',
          }),
        ],
      }),
      makeField({
        key: 'brand:slug',
        path: ['Slug'],
        changesUrl: true,
        matches: [
          makeMatch({
            key: 'brand:slug:0',
            text: 'acme',
            after: '-brand-guidelines',
          }),
        ],
      }),
      makeField({
        key: 'brand:seo:en',
        path: ['SEO', 'Description'],
        locale: 'en',
        matches: [
          makeMatch({
            key: 'brand:seo:en:0',
            before: 'Download the ',
            text: 'Acme',
            after: ' logo pack and the full color palette for print and',
            afterTruncated: true,
          }),
        ],
      }),
    ],
  });
}

function aboutUs(): RecordView {
  return makeRecord({
    modelId: 'page',
    modelName: 'Page',
    recordId: 'about',
    title: 'About us',
    fields: [
      makeField({
        key: 'about:content:en',
        path: ['Content', 'Text block', 'Body'],
        locale: 'en',
        matches: [
          makeMatch({
            key: 'about:content:en:0',
            before: 'Founded in 1998, ',
            text: 'Acme',
            after: ' builds tools for teams that publish in many',
            afterTruncated: true,
          }),
        ],
      }),
      makeField({
        key: 'about:seo:en',
        path: ['SEO', 'Title'],
        locale: 'en',
        matches: [
          makeMatch({ key: 'about:seo:en:0', before: 'About ', text: 'Acme' }),
        ],
      }),
    ],
  });
}

function legalNotice(): RecordView {
  return makeRecord({
    modelId: 'page',
    modelName: 'Page',
    recordId: 'legal',
    title: 'Legal notice',
    fields: [
      makeField({
        key: 'legal:content:en',
        path: ['Content', 'Text block', 'Body'],
        locale: 'en',
        matches: [
          makeMatch({
            key: 'legal:content:en:0',
            before: 'Every logo on this site is a registered trademark of ',
            beforeTruncated: true,
            text: 'Acme',
            after: ' Inc. and all of its subsidiaries worldwide',
            afterTruncated: true,
          }),
        ],
      }),
    ],
  });
}

/** Find mode: plain highlights, no checkboxes. */
export function acmeRecords(): RecordView[] {
  return [acmeLaunches(), brandGuidelines(), aboutUs(), legalNotice()];
}

type PlanView = {
  replacement: string;
  excludedMatches?: ReadonlyArray<string>;
  excludedRecords?: ReadonlyArray<string>;
  noChange?: ReadonlyArray<string>;
};

function planDisplay(
  match: MatchView,
  included: boolean,
  view: PlanView,
): MatchDisplay {
  if (!included) {
    return HIGHLIGHT;
  }
  if (view.noChange?.includes(match.key)) {
    return { kind: 'noChange' };
  }
  return { kind: 'diff', inserted: view.replacement };
}

/** Plan mode: diffs for included matches, slugs left out, checkboxes where they exist. */
export function toPlan(
  records: ReadonlyArray<RecordView>,
  view: PlanView,
): RecordView[] {
  return records.map((record) => {
    const recordExcluded = view.excludedRecords?.includes(record.key) ?? false;
    const selectable = record.matchCount >= 2;
    let included = 0;
    const fields = record.fields.map((field) => ({
      ...field,
      matches: field.matches.map((match) => {
        const isIncluded =
          !recordExcluded &&
          !field.changesUrl &&
          !(view.excludedMatches?.includes(match.key) ?? false);
        if (isIncluded) {
          included += 1;
        }
        return {
          ...match,
          included: isIncluded,
          selectable,
          display: planDisplay(match, isIncluded, view),
        };
      }),
    }));
    let inclusion: RecordView['inclusion'] = 'some';
    if (included === record.matchCount) {
      inclusion = 'all';
    } else if (included === 0) {
      inclusion = 'none';
    }
    return { ...record, fields, inclusion, selectable: true };
  });
}

/** After a write: what was written shows as final text, the rest keeps its highlight. */
function toReport(
  record: RecordView,
  status: RecordRunStatus,
  title: string | null = record.title,
  publish: RecordPublishStatus = { kind: 'none' },
): RecordView {
  const written = status.kind === 'replaced';
  return {
    ...record,
    title,
    status,
    publish,
    selectable: false,
    fields: record.fields.map((field) => ({
      ...field,
      matches: field.matches.map((match) => {
        const display: MatchDisplay =
          written && match.display.kind === 'diff'
            ? { kind: 'final', inserted: match.display.inserted }
            : match.display;
        return { ...match, selectable: false, display };
      }),
    })),
  };
}

const ACME_FILTER = {
  visible: true,
  enabled: true,
  selected: null,
  options: [
    { id: 'article', name: 'Article', matchCount: 6 },
    { id: 'page', name: 'Page', matchCount: 3 },
  ],
  allMatchCount: 9,
  partial: false,
} satisfies FindReplaceSnapshot['modelFilter'];

// ── States ──────────────────────────────────────────────────────────────────

function withSearch(
  snapshot: FindReplaceSnapshot,
  patch: Partial<FindReplaceSnapshot['search']>,
): FindReplaceSnapshot['search'] {
  return { ...snapshot.search, ...patch };
}

function typingSnapshot(): FindReplaceSnapshot {
  const base = idleSnapshot();
  return {
    ...base,
    find: { ...base.find, pattern: 'Acm' },
    findRow: { ...base.findRow, showClear: true },
    search: withSearch(base, { phase: 'pending' }),
    primary: disabledPrimary('search_running'),
  };
}

function invalidSnapshot(): FindReplaceSnapshot {
  const base = idleSnapshot();
  return {
    ...base,
    find: { ...base.find, pattern: 'Acme(', regex: true },
    findRow: { ...base.findRow, showClear: true },
    search: withSearch(base, {
      phase: 'invalid',
      resultsId: 1,
      patternProblem: { code: 'invalid_regex', cause: 'unterminated group' },
    }),
    primary: disabledPrimary('invalid_pattern'),
    body: 'invalid',
  };
}

function searchingSnapshot(): FindReplaceSnapshot {
  const base = idleSnapshot();
  return {
    ...base,
    find: { ...base.find, pattern: 'Acme' },
    findRow: { ...base.findRow, showClear: true },
    search: withSearch(base, {
      phase: 'searching',
      resultsId: 1,
      showProgress: true,
      progress: { searched: 300, total: null },
    }),
    primary: disabledPrimary('search_running'),
    body: 'spinner',
  };
}

function streamingSnapshot(): FindReplaceSnapshot {
  const base = searchingSnapshot();
  return {
    ...base,
    findRow: { ...base.findRow, showEraser: true },
    search: withSearch(base, { progress: { searched: 1200, total: 3400 } }),
    meta: { kind: 'found', matches: 4, records: 2, capped: false },
    body: 'results',
    records: [acmeLaunches(), legalNotice()],
  };
}

/** S7: settled, find mode. */
export function resultsSnapshot(): FindReplaceSnapshot {
  const base = idleSnapshot();
  return {
    ...base,
    find: { ...base.find, pattern: 'Acme' },
    findRow: { ...base.findRow, showClear: true, showEraser: true },
    search: withSearch(base, { phase: 'settled', resultsId: 1 }),
    modelFilter: ACME_FILTER,
    primary: disabledPrimary('no_replacement'),
    meta: { kind: 'found', matches: 9, records: 4, capped: false },
    body: 'results',
    records: acmeRecords(),
  };
}

const THE_SENTENCES = [
  ['In 1987, ', ' founders opened a small shop near the harbor'],
  ['we believe ', ' best work happens when people trust each'],
  ['and ', ' people who make it. Every product starts with'],
  ['listening to ', ' customer first, then building what they'],
  ['over ', ' years we grew from two people to'],
] as const;

function theMatches(prefix: string, count: number): MatchView[] {
  return Array.from({ length: count }, (_, index) => {
    const [before, after] = THE_SENTENCES[index % THE_SENTENCES.length];
    return makeMatch({
      key: `${prefix}:${index}`,
      before,
      beforeTruncated: index > 0,
      text: 'the',
      after,
      afterTruncated: true,
    });
  });
}

/** 120 records: 52 matches in the first, 14 in the second, then 1–3 each. */
export function manyRecords(): RecordView[] {
  const records: RecordView[] = [
    makeRecord({
      modelId: 'article',
      modelName: 'Article',
      recordId: 'history',
      title: 'The history of the company',
      fields: [
        makeField({
          key: 'history:title:en',
          path: ['Title'],
          locale: 'en',
          matches: [
            makeMatch({
              key: 'history:title:0',
              text: 'The',
              after: ' history of the company',
            }),
            makeMatch({
              key: 'history:title:1',
              before: 'The history of ',
              text: 'the',
              after: ' company',
            }),
          ],
        }),
        makeField({
          key: 'history:body:en',
          path: ['Body'],
          locale: 'en',
          matches: theMatches('history:body', 50),
        }),
      ],
    }),
    makeRecord({
      modelId: 'article',
      modelName: 'Article',
      recordId: 'values',
      title: 'Our values',
      fields: [
        makeField({
          key: 'values:body:en',
          path: ['Body'],
          locale: 'en',
          matches: theMatches('values:body', 14),
        }),
      ],
    }),
  ];
  for (let index = 1; index <= 118; index += 1) {
    records.push(
      makeRecord({
        modelId: index % 3 === 0 ? 'page' : 'article',
        modelName: index % 3 === 0 ? 'Page' : 'Article',
        recordId: `note-${index}`,
        title: `Field notes ${index}`,
        fields: [
          makeField({
            key: `note-${index}:body:en`,
            path: ['Body'],
            locale: 'en',
            matches: theMatches(`note-${index}:body`, (index % 3) + 1),
          }),
        ],
      }),
    );
  }
  return records;
}

function cappedSnapshot(): FindReplaceSnapshot {
  const base = resultsSnapshot();
  return {
    ...base,
    find: { ...base.find, pattern: 'the', wholeWord: true },
    search: withSearch(base, { capped: true }),
    modelFilter: {
      ...ACME_FILTER,
      options: [
        { id: 'article', name: 'Article', matchCount: 6912 },
        { id: 'page', name: 'Page', matchCount: 3088 },
      ],
      allMatchCount: 10000,
      partial: true,
    },
    meta: { kind: 'found', matches: 10000, records: 2310, capped: true },
    note: { kind: 'capped', selfMatch: false, continued: false },
    records: manyRecords(),
  };
}

/** S26: large project, new text typed but not searched yet (results are the old search's). */
function enterHintSnapshot(): FindReplaceSnapshot {
  const base = resultsSnapshot();
  return {
    ...base,
    find: { ...base.find, pattern: 'Acme Corp' },
    findRow: { ...base.findRow, enterToSearch: true, awaitingEnter: true },
    primary: disabledPrimary('press_enter'),
  };
}

/** S27: large project, reading its records, with the time left. */
function largeSearchSnapshot(): FindReplaceSnapshot {
  const base = streamingSnapshot();
  return {
    ...base,
    findRow: { ...base.findRow, enterToSearch: true },
    search: withSearch(base, {
      progress: { searched: 48000, total: 184000 },
      secondsLeft: 170,
    }),
  };
}

/** S28: "Search again" read on from where a capped search stopped, and was capped again. */
function continuedCappedSnapshot(): FindReplaceSnapshot {
  const base = cappedSnapshot();
  return {
    ...base,
    search: withSearch(base, { continued: true, followsRun: true }),
    note: { kind: 'capped', selfMatch: false, continued: true },
  };
}

function noResultsSnapshot(): FindReplaceSnapshot {
  const base = idleSnapshot();
  return {
    ...base,
    find: { ...base.find, pattern: 'Acme Corp', caseSensitive: true },
    findRow: { ...base.findRow, showClear: true },
    search: withSearch(base, { phase: 'settled', resultsId: 1 }),
    meta: { kind: 'noMatches' },
    body: 'noResults',
    noResults: {
      followsRun: false,
      continued: false,
      runVerb: 'replace',
      caseSensitive: true,
      wholeWord: false,
      regex: false,
      filteredModelName: null,
      otherModelsHaveMatches: false,
    },
  };
}

function modelsFailedSnapshot(): FindReplaceSnapshot {
  const base = resultsSnapshot();
  return {
    ...base,
    search: withSearch(base, {
      failedModels: [
        { id: 'author', name: 'Author' },
        { id: 'legal_page', name: 'Legal page' },
      ],
    }),
    modelFilter: {
      ...ACME_FILTER,
      options: [
        ...ACME_FILTER.options.slice(0, 1),
        { id: 'author', name: 'Author', matchCount: null },
        { id: 'legal_page', name: 'Legal page', matchCount: null },
        ...ACME_FILTER.options.slice(1),
      ],
    },
    meta: { kind: 'found', matches: 118, records: 35, capped: false },
    callouts: [
      {
        kind: 'modelsFailed',
        modelNames: ['Author', 'Legal page'],
        retryable: true,
      },
    ],
    records: [acmeLaunches()],
  };
}

function searchStoppedSnapshot(): FindReplaceSnapshot {
  const base = resultsSnapshot();
  return {
    ...base,
    search: withSearch(base, {
      stopped: true,
      progress: { searched: 1200, total: 3400 },
    }),
    modelFilter: { ...ACME_FILTER, partial: true },
    meta: { kind: 'found', matches: 24, records: 9, capped: false },
    note: { kind: 'searchStopped', searched: 1200, total: 3400 },
    records: [acmeLaunches()],
  };
}

/** S11: "Globex" typed; the slug starts left out. */
export function planSnapshot(): FindReplaceSnapshot {
  const base = resultsSnapshot();
  return {
    ...base,
    replace: { text: 'Globex', remove: false },
    verb: 'replace',
    primary: { kind: 'replace', verb: 'replace', count: 8, enabled: true },
    meta: { kind: 'willChange', changing: 8, found: 9, verb: 'replace' },
    selection: { ui: 'enabled', all: 'some' },
    records: toPlan(acmeRecords(), { replacement: 'Globex' }),
    plan: makePlan({
      token: 'plan-s11',
      matchCount: 8,
      recordCount: 4,
      liveRecordCount: 2,
    }),
  };
}

function removeSnapshot(): FindReplaceSnapshot {
  const base = resultsSnapshot();
  const tm = (recordId: string, title: string, model: 'article' | 'page') =>
    makeRecord({
      modelId: model,
      modelName: model === 'page' ? 'Page' : 'Article',
      recordId,
      title: `${title}™`,
      selectable: true,
      fields: [
        makeField({
          key: `${recordId}:title:en`,
          path: ['Title'],
          locale: 'en',
          matches: [
            makeMatch({
              key: `${recordId}:title:en:0`,
              before: title,
              text: '™',
              display: { kind: 'diff', inserted: '' },
            }),
          ],
        }),
      ],
    });
  return {
    ...base,
    find: { ...base.find, pattern: '™' },
    replace: { text: '', remove: true },
    verb: 'remove',
    primary: { kind: 'replace', verb: 'remove', count: 3, enabled: true },
    meta: { kind: 'found', matches: 3, records: 3, capped: false },
    selection: { ui: 'enabled', all: 'all' },
    records: [
      tm('launch', 'Acme launches a new widget', 'article'),
      tm('review', 'Widget X review', 'article'),
      tm('pricing', 'Pricing', 'page'),
    ],
    plan: makePlan({
      token: 'plan-s11b',
      verb: 'remove',
      matchCount: 3,
      recordCount: 3,
      pattern: '™',
      replacementText: '',
    }),
  };
}

function noChangeSnapshot(): FindReplaceSnapshot {
  const base = resultsSnapshot();
  const team = makeRecord({
    modelId: 'article',
    modelName: 'Article',
    recordId: 'team',
    title: 'About the acme team',
    fields: [
      makeField({
        key: 'team:title:en',
        path: ['Title'],
        locale: 'en',
        matches: [
          makeMatch({
            key: 'team:title:en:0',
            before: 'About the ',
            text: 'acme',
            after: ' team',
          }),
        ],
      }),
      makeField({
        key: 'team:body:en',
        path: ['Body'],
        locale: 'en',
        matches: [
          makeMatch({
            key: 'team:body:en:0',
            before: 'The company was founded by the ',
            beforeTruncated: true,
            text: 'Acme',
            after: ' partners in a garage in',
            afterTruncated: true,
          }),
        ],
      }),
    ],
  });
  return {
    ...base,
    find: { ...base.find, pattern: 'acme' },
    replace: { text: 'Acme', remove: false },
    verb: 'replace',
    replacementCheck: { problem: null, warnings: [{ code: 'self_match' }] },
    primary: { kind: 'replace', verb: 'replace', count: 5, enabled: true },
    meta: { kind: 'willChange', changing: 5, found: 9, verb: 'replace' },
    selection: { ui: 'enabled', all: 'some' },
    records: toPlan([team, brandGuidelines()], {
      replacement: 'Acme',
      noChange: ['team:body:en:0', 'brand:seo:en:0'],
    }),
    plan: makePlan({
      token: 'plan-s11c',
      matchCount: 5,
      recordCount: 4,
      pattern: 'acme',
      replacementText: 'Acme',
    }),
  };
}

const S12_EXCLUSIONS = {
  replacement: 'Globex',
  excludedMatches: ['launch:body:en:0'],
  excludedRecords: ['page:legal'],
};

/** S12: one match and one record left out. */
export function excludingSnapshot(): FindReplaceSnapshot {
  const base = planSnapshot();
  return {
    ...base,
    primary: { kind: 'replace', verb: 'replace', count: 6, enabled: true },
    meta: { kind: 'willChange', changing: 6, found: 9, verb: 'replace' },
    records: toPlan(acmeRecords(), S12_EXCLUSIONS),
    plan: makePlan({ token: 'plan-s12' }),
    hasManualSelection: true,
  };
}

function filterOpenSnapshot(): FindReplaceSnapshot {
  const base = excludingSnapshot();
  return {
    ...base,
    modelFilter: {
      ...ACME_FILTER,
      options: [
        ACME_FILTER.options[0],
        { id: 'author', name: 'Author', matchCount: null },
        ACME_FILTER.options[1],
      ],
    },
  };
}

function replacingSnapshot(phase: 'running' | 'stopping'): FindReplaceSnapshot {
  const base = excludingSnapshot();
  const [launch, brand, about, legal] = toPlan(acmeRecords(), S12_EXCLUSIONS);
  return {
    ...base,
    findRow: { ...base.findRow, enabled: false },
    modelFilter: { ...ACME_FILTER, enabled: false },
    primary: disabledPrimary('replacing', { count: 6, busy: true }),
    selection: { ui: 'disabled', all: 'some' },
    records: [
      toReport(
        launch,
        { kind: 'replaced', replacedMatches: 2 },
        'Globex launches a new widget',
      ),
      toReport(brand, { kind: 'writing' }),
      about,
      legal,
    ],
    run: {
      phase,
      verb: 'replace',
      progress: { done: 1, total: 3, updated: 1 },
      totals: null,
    },
    plan: null,
  };
}

function finishedBase(): FindReplaceSnapshot {
  const base = excludingSnapshot();
  return {
    ...base,
    primary: { kind: 'searchAgain', publish: null },
    selection: { ui: 'hidden', all: 'some' },
    plan: null,
    hasManualSelection: true,
  };
}

/** S16's offer: two records publish; "Brand guidelines" had other unpublished changes. */
const PUBLISH_OFFER: PublishOffer = {
  token: 'publish-token',
  recordCount: 2,
  heldCount: 1,
};

function finishedSnapshot(): FindReplaceSnapshot {
  const base = finishedBase();
  const [launch, brand, about] = toPlan(acmeRecords(), S12_EXCLUSIONS);
  return {
    ...base,
    primary: { kind: 'searchAgain', publish: PUBLISH_OFFER },
    meta: {
      kind: 'runFinished',
      verb: 'replace',
      replacedMatches: 6,
      skippedRecords: 0,
      failedRecords: 0,
      publishedRecords: 0,
    },
    records: [
      toReport(
        launch,
        { kind: 'replaced', replacedMatches: 2 },
        'Globex launches a new widget',
        { kind: 'ready' },
      ),
      toReport(
        brand,
        { kind: 'replaced', replacedMatches: 2 },
        'Globex brand guidelines',
      ),
      toReport(
        about,
        { kind: 'replaced', replacedMatches: 2 },
        about?.title ?? null,
        { kind: 'ready' },
      ),
    ],
    run: {
      phase: 'finished',
      verb: 'replace',
      progress: { done: 3, total: 3, updated: 3 },
      totals: makeTotals({
        replacedMatches: 6,
        replacedRecords: 3,
        plannedRecords: 3,
        plannedMatches: 6,
      }),
    },
  };
}

/** S16 with each record's publish status replaced, in order. */
function withPublishStatuses(
  snapshot: FindReplaceSnapshot,
  statuses: ReadonlyArray<RecordPublishStatus>,
): ReadonlyArray<RecordView> {
  return snapshot.records.map((record, index) => ({
    ...record,
    publish: statuses[index] ?? record.publish,
  }));
}

/** S24: publishing after the run, second record in flight. */
function publishingSnapshot(): FindReplaceSnapshot {
  const base = finishedSnapshot();
  return {
    ...base,
    findRow: { ...base.findRow, enabled: false },
    modelFilter: { ...base.modelFilter, enabled: false },
    primary: { kind: 'publishing', count: 2 },
    records: withPublishStatuses(base, [
      { kind: 'published' },
      { kind: 'none' },
      { kind: 'publishing' },
    ]),
    publish: {
      phase: 'running',
      progress: { done: 1, total: 2, published: 1 },
    },
  };
}

/** S25: publishing ended; one record held back, one failed validation. */
function publishedSnapshot(): FindReplaceSnapshot {
  const base = finishedSnapshot();
  return {
    ...base,
    primary: { kind: 'searchAgain', publish: null },
    meta: {
      kind: 'runFinished',
      verb: 'replace',
      replacedMatches: 6,
      skippedRecords: 0,
      failedRecords: 0,
      publishedRecords: 1,
    },
    records: withPublishStatuses(base, [
      { kind: 'published' },
      { kind: 'held', reason: 'other_changes' },
      {
        kind: 'failed',
        reason: 'validation',
        retryable: false,
        detail: { fieldLabel: 'Published on', code: 'required' },
      },
    ]),
    publish: {
      phase: 'done',
      progress: { done: 2, total: 2, published: 1 },
    },
  };
}

function singleMatchRecord(
  recordId: string,
  modelName: 'Article' | 'Page',
  title: string,
  path: ReadonlyArray<string>,
  before: string,
  after: string,
): RecordView {
  return makeRecord({
    modelId: modelName.toLowerCase(),
    modelName,
    recordId,
    title,
    fields: [
      makeField({
        key: `${recordId}:field`,
        path,
        locale: 'en',
        matches: [
          makeMatch({
            key: `${recordId}:field:0`,
            before,
            beforeTruncated: before !== '',
            text: 'Acme',
            after,
            afterTruncated: true,
            display: { kind: 'diff', inserted: 'Globex' },
          }),
        ],
      }),
    ],
  });
}

function failedSnapshot(): FindReplaceSnapshot {
  const base = finishedBase();
  const [launch] = toPlan(acmeRecords(), S12_EXCLUSIONS);
  return {
    ...base,
    meta: {
      kind: 'runFinished',
      verb: 'replace',
      replacedMatches: 119,
      skippedRecords: 0,
      failedRecords: 2,
      publishedRecords: 0,
    },
    callouts: [
      { kind: 'recordsFailed', count: 2, retryable: true, singleReason: null },
    ],
    records: [
      toReport(
        singleMatchRecord(
          'pricing',
          'Article',
          'Acme pricing',
          ['Title'],
          '',
          ' pricing for teams, agencies and enterprise customers',
        ),
        {
          kind: 'failed',
          reason: 'validation',
          retryable: false,
          detail: { fieldLabel: 'Title', code: 'length' },
        },
      ),
      toReport(
        singleMatchRecord(
          'careers',
          'Page',
          'Careers',
          ['Body'],
          'Come and join the ',
          ' team in Milan or remote, wherever you',
        ),
        { kind: 'failed', reason: 'network', retryable: true, detail: null },
      ),
      toReport(
        launch,
        { kind: 'replaced', replacedMatches: 2 },
        'Globex launches a new widget',
      ),
    ],
    run: {
      phase: 'finished',
      verb: 'replace',
      progress: { done: 40, total: 40, updated: 38 },
      totals: makeTotals({
        replacedMatches: 119,
        replacedRecords: 38,
        failedRecords: 2,
        retryableFailedRecords: 1,
        plannedRecords: 40,
        plannedMatches: 121,
      }),
    },
  };
}

function skippedSnapshot(): FindReplaceSnapshot {
  const base = finishedBase();
  const [launch] = toPlan(acmeRecords(), S12_EXCLUSIONS);
  const offsite = makeRecord({
    modelId: 'article',
    modelName: 'Article',
    recordId: 'offsite',
    title: 'Team offsite',
    fields: [
      makeField({
        key: 'offsite:body:en',
        path: ['Body'],
        locale: 'en',
        matches: [
          makeMatch({
            key: 'offsite:body:en:0',
            before: 'This spring, at the ',
            beforeTruncated: true,
            text: 'Acme',
            after: ' offsite in Lisbon, we planned the next',
            afterTruncated: true,
            display: { kind: 'diff', inserted: 'Globex' },
          }),
          makeMatch({
            key: 'offsite:body:en:1',
            before: 'thanks to everyone at ',
            beforeTruncated: true,
            text: 'Acme',
            after: ' who made it happen, and to',
            afterTruncated: true,
            display: { kind: 'diff', inserted: 'Globex' },
          }),
        ],
      }),
    ],
  });
  return {
    ...base,
    meta: {
      kind: 'runFinished',
      verb: 'replace',
      replacedMatches: 115,
      skippedRecords: 3,
      failedRecords: 0,
      publishedRecords: 0,
    },
    callouts: [{ kind: 'recordsSkipped', count: 3, allStale: true }],
    records: [
      toReport(offsite, { kind: 'skipped', reason: 'stale' }),
      toReport(
        launch,
        { kind: 'replaced', replacedMatches: 2 },
        'Globex launches a new widget',
      ),
    ],
    run: {
      phase: 'finished',
      verb: 'replace',
      progress: { done: 40, total: 40, updated: 37 },
      totals: makeTotals({
        replacedMatches: 115,
        replacedRecords: 37,
        skippedRecords: 3,
        staleSkippedRecords: 3,
        plannedRecords: 40,
        plannedMatches: 121,
      }),
    },
  };
}

function runStoppedSnapshot(): FindReplaceSnapshot {
  const base = excludingSnapshot();
  const [launch] = toPlan(acmeRecords(), S12_EXCLUSIONS);
  const report = makeRecord({
    modelId: 'article',
    modelName: 'Article',
    recordId: 'q3',
    title: 'Q3 report',
    selectable: true,
    fields: [
      makeField({
        key: 'q3:seo:it',
        path: ['SEO', 'Description'],
        locale: 'it',
        matches: [
          makeMatch({
            key: 'q3:seo:it:0',
            before: 'Tutti i risultati di ',
            text: 'Acme',
            after: ' nel terzo trimestre, spiegati bene',
            afterTruncated: true,
            display: { kind: 'diff', inserted: 'Globex' },
          }),
        ],
      }),
    ],
  });
  return {
    ...base,
    primary: { kind: 'replace', verb: 'replace', count: 73, enabled: true },
    meta: {
      kind: 'runStopped',
      verb: 'replace',
      replacedMatches: 48,
      plannedMatches: 121,
    },
    selection: { ui: 'enabled', all: 'all' },
    records: [
      report,
      toReport(
        launch,
        { kind: 'replaced', replacedMatches: 2 },
        'Globex launches a new widget',
      ),
    ],
    run: {
      phase: 'stopped',
      verb: 'replace',
      progress: { done: 18, total: 37, updated: 18 },
      totals: makeTotals({
        replacedMatches: 48,
        replacedRecords: 18,
        notAttemptedRecords: 19,
        plannedRecords: 37,
        plannedMatches: 121,
      }),
    },
    plan: makePlan({ token: 'plan-s19', matchCount: 73, recordCount: 19 }),
    hasManualSelection: false,
  };
}

function everyMatchReplacedSnapshot(): FindReplaceSnapshot {
  const base = noResultsSnapshot();
  return {
    ...base,
    find: { ...base.find, pattern: 'Acme', caseSensitive: false },
    replace: { text: 'Globex', remove: false },
    verb: 'replace',
    search: withSearch(base, { resultsId: 2, followsRun: true }),
    noResults: {
      followsRun: true,
      continued: false,
      runVerb: 'replace',
      caseSensitive: false,
      wholeWord: false,
      regex: false,
      filteredModelName: null,
      otherModelsHaveMatches: false,
    },
  };
}

function searchFailedSnapshot(): FindReplaceSnapshot {
  const base = idleSnapshot();
  return {
    ...base,
    find: { ...base.find, pattern: 'Acme' },
    findRow: { ...base.findRow, showClear: true },
    search: withSearch(base, {
      phase: 'failed',
      resultsId: 1,
      failure: { cause: 'network' },
    }),
    body: 'searchFailed',
  };
}

// ── The state catalog ───────────────────────────────────────────────────────

export const STATE_IDS = [
  'S1',
  'S2',
  'S3',
  'S4',
  'S5',
  'S6',
  'S7',
  'S8',
  'S9',
  'S10a',
  'S10b',
  'S11',
  'S11b',
  'S11c',
  'S12',
  'S12b',
  'S13',
  'S14',
  'S15',
  'S16',
  'S17',
  'S18',
  'S19',
  'S20',
  'S21',
  'S22',
  'S23',
  'S24',
  'S25',
  'S26',
  'S27',
  'S28',
] as const;

export type StateId = (typeof STATE_IDS)[number];

/** A boot view without its live parts (the controller, `retry`). */
export type BootFixture =
  | { status: 'booting' }
  | { status: 'unavailable'; cause: 'role' | 'no_models' | 'token' }
  | { status: 'failed'; cause: 'network' | 'unknown' };

export type StateFixture = {
  id: StateId;
  label: string;
  /** Boot-only states (S1, S22, S23) have a boot view and no snapshot. */
  boot: BootFixture | null;
  snapshot: FindReplaceSnapshot | null;
  /**
   * The UI-local part of the state, reached by interacting: open the model
   * filter (S12b) or click the primary to see the host confirm (S13).
   */
  interaction: 'openModelFilter' | 'openConfirm' | null;
};

type Entry = {
  label: string;
  build: () => FindReplaceSnapshot | BootFixture;
  interaction?: StateFixture['interaction'];
};

const ENTRIES: Record<StateId, Entry> = {
  S1: { label: 'Booting', build: () => ({ status: 'booting' }) },
  S2: { label: 'Idle', build: idleSnapshot },
  S3: { label: 'Typing', build: typingSnapshot },
  S4: { label: 'Invalid pattern', build: invalidSnapshot },
  S5: { label: 'Searching, nothing found yet', build: searchingSnapshot },
  S6: { label: 'Searching, results streaming', build: streamingSnapshot },
  S7: { label: 'Results (find only)', build: resultsSnapshot },
  S8: { label: 'Results, capped and chunked', build: cappedSnapshot },
  S9: { label: 'No results', build: noResultsSnapshot },
  S10a: {
    label: "Some models couldn't be searched",
    build: modelsFailedSnapshot,
  },
  S10b: { label: 'Search stopped', build: searchStoppedSnapshot },
  S11: { label: 'Replacement typed (plan)', build: planSnapshot },
  S11b: { label: 'Replace with nothing', build: removeSnapshot },
  S11c: { label: 'No change and a warning', build: noChangeSnapshot },
  S12: { label: 'Leaving matches out', build: excludingSnapshot },
  S12b: {
    label: 'Model filter open',
    build: filterOpenSnapshot,
    interaction: 'openModelFilter',
  },
  S13: {
    label: 'Confirm',
    build: excludingSnapshot,
    interaction: 'openConfirm',
  },
  S14: { label: 'Replacing', build: () => replacingSnapshot('running') },
  S15: { label: 'Stopping', build: () => replacingSnapshot('stopping') },
  S16: { label: 'Done: everything replaced', build: finishedSnapshot },
  S17: { label: 'Done: some records failed', build: failedSnapshot },
  S18: { label: 'Done: some records skipped', build: skippedSnapshot },
  S19: { label: 'Replacement stopped', build: runStoppedSnapshot },
  S20: {
    label: 'Every match has been replaced',
    build: everyMatchReplacedSnapshot,
  },
  S21: { label: 'Search failed', build: searchFailedSnapshot },
  S22: {
    label: 'Unavailable',
    build: () => ({ status: 'unavailable', cause: 'role' }),
  },
  S23: {
    label: 'Boot error',
    build: () => ({ status: 'failed', cause: 'network' }),
  },
  S24: { label: 'Publishing', build: publishingSnapshot },
  S25: { label: 'Published', build: publishedSnapshot },
  S26: { label: 'Large project: press Enter', build: enterHintSnapshot },
  S27: { label: 'Large project: time left', build: largeSearchSnapshot },
  S28: {
    label: 'Capped again after reading on',
    build: continuedCappedSnapshot,
  },
};

function isBootFixture(
  value: FindReplaceSnapshot | BootFixture,
): value is BootFixture {
  return 'status' in value;
}

export function stateFixture(id: StateId): StateFixture {
  const entry = ENTRIES[id];
  const built = entry.build();
  return {
    id,
    label: entry.label,
    boot: isBootFixture(built) ? built : null,
    snapshot: isBootFixture(built) ? null : built,
    interaction: entry.interaction ?? null,
  };
}

/**
 * The `boot` prop for a state, with a fake controller serving the state's
 * snapshot (null for the boot-only states).
 */
export function stateBoot(
  id: StateId,
  retry: () => void = () => {},
): { boot: BootView; controller: FakeController | null } {
  const fixture = stateFixture(id);
  if (fixture.snapshot) {
    const controller = createFakeController(fixture.snapshot);
    return { boot: { status: 'ready', controller }, controller };
  }
  const boot = fixture.boot ?? { status: 'booting' };
  return {
    boot: boot.status === 'failed' ? { ...boot, retry } : boot,
    controller: null,
  };
}
