import type { CommentType } from '../../src/entrypoints/types/comments';
import md5 from 'md5';
import type { StoredCommentSegment } from '../../src/entrypoints/types/mentions';
import {
  assertMigrationMatches,
  type LegacyModel,
  type MigrationResults,
  prepareLegacyComments,
} from '../../src/entrypoints/utils/legacyMigration';
import type { LegacyComment } from '../../src/entrypoints/utils/migrations';
import { isValidCommentArray } from '../../src/entrypoints/utils/typeGuards';

// Pure data/assertion helpers: no clients, credentials, requests, or cleanup.
export const RUN_TAG = '20261003';
export const MODEL_API_KEY = 'qa_record_comments_october_source';
export const SOURCE_COUNT = 1000;
export const PREFIX = `qa-record-comments-${RUN_TAG}`;

export type QaActor = { id: string; name: string; email: string };
export type QaFixtureOptions = {
  index: number;
  locales: string[];
  modelId: string;
  currentUser: QaActor;
  recordIds: string[];
};
export type QaRecord = { id: string; [key: string]: unknown };
type QaLegacyComment = LegacyComment & {
  qaFixture: {
    prefix: string;
    sequence: number;
    locale: string;
    rootIndex: number;
    replyIndex?: number;
  };
};

const historicalAuthor = {
  name: 'QA historical author',
  email: `${PREFIX}-historical-author@qa.invalid`,
};
const historicalVoter = {
  name: 'QA historical voter',
  email: `${PREFIX}-historical-voter@qa.invalid`,
};

function requireQa(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Record comments live QA: ${message}`);
}

function validateLocales(locales: string[]) {
  requireQa(
    locales.length === 8 && new Set(locales).size === 8,
    'exactly eight distinct project locales are required',
  );
  requireQa(
    locales.includes('en') && locales.includes('pt'),
    'the sentinel requires project locales en and pt',
  );
}

function validateOptions(options: QaFixtureOptions) {
  validateLocales(options.locales);
  requireQa(
    Number.isInteger(options.index) &&
      options.index >= 0 &&
      options.index < SOURCE_COUNT,
    'source sequence is outside the bounded fixture set',
  );
  requireQa(
    options.currentUser.id && options.currentUser.email && options.modelId,
    'the existing SDK user and source model are required',
  );
  requireQa(
    options.recordIds.length === SOURCE_COUNT &&
      options.recordIds[options.index] === recordIdForIndex(options.index) &&
      (options.index === 0 ||
        options.recordIds[options.index - 1] === recordIdForIndex(options.index - 1)),
    'the bounded deterministic source ID manifest is required',
  );
}

function fixtureKey(index: number) {
  return `${PREFIX}-${String(index).padStart(4, '0')}`;
}

function commentDate(index: number, rootIndex: number, replyIndex = -1) {
  return new Date(
    Date.UTC(2026, 0, 1) + index * 100_000 + rootIndex * 1000 + replyIndex + 1,
  ).toISOString();
}

function rootContent(
  options: QaFixtureOptions,
  locale: string,
  rootIndex: number,
): StoredCommentSegment[] {
  const content: StoredCommentSegment[] = [
    {
      type: 'text',
      content: `${fixtureKey(options.index)} [${locale}] root ${rootIndex}: café 日本語 😀\nPreserve this line.`,
    },
    {
      type: 'mention',
      mention: {
        type: 'field',
        modelId: options.modelId,
        fieldPath: 'title',
        locale,
      },
    },
    { type: 'mention', mention: { type: 'user', id: options.currentUser.id } },
    { type: 'mention', mention: { type: 'model', id: options.modelId } },
  ];
  if (options.index > 0) {
    content.push({
      type: 'mention',
      mention: {
        type: 'record',
        id: options.recordIds[options.index - 1],
        modelId: options.modelId,
      },
    });
  }
  return content;
}

function makeRoot(
  options: QaFixtureOptions,
  locale: string,
  rootIndex: number,
): QaLegacyComment {
  const dateISO = commentDate(options.index, rootIndex);
  const replyCount =
    options.index === 0
      ? locale === 'en' && rootIndex === 0
        ? 130
        : 0
      : 1;
  return {
    dateISO,
    content: rootContent(options, locale, rootIndex),
    author: {
      name: options.currentUser.name,
      email: options.currentUser.email,
    },
    usersWhoUpvoted: [options.currentUser.email, historicalVoter],
    qaFixture: { prefix: PREFIX, sequence: options.index, locale, rootIndex },
    replies: Array.from({ length: replyCount }, (_, replyIndex) => ({
      dateISO: commentDate(options.index, rootIndex, replyIndex),
      content: `${fixtureKey(options.index)} [${locale}] reply ${replyIndex}: ação 日本語 😀`,
      author:
        replyIndex % 2 === 0
          ? { name: options.currentUser.name, email: options.currentUser.email }
          : historicalAuthor,
      usersWhoUpvoted: [options.currentUser.email],
      parentCommentISO: dateISO,
      qaFixture: {
        prefix: PREFIX,
        sequence: options.index,
        locale,
        rootIndex,
        replyIndex,
      },
    })),
  };
}

/** Each localized JSON field value is an API JSON string, not a nested object. */
export function createSourcePayload(options: QaFixtureOptions) {
  validateOptions(options);
  const key = fixtureKey(options.index);
  return {
    id: options.recordIds[options.index],
    item_type: { type: 'item_type' as const, id: options.modelId },
    title: Object.fromEntries(
      options.locales.map((locale) => [locale, `${key} title ${locale}`]),
    ),
    summary: Object.fromEntries(
      options.locales.map((locale) => [
        locale,
        `${key} summary ${locale}: café 日本語 😀\nLocalized content must survive.`,
      ]),
    ),
    single_locale_note: Object.fromEntries(
      options.locales.map((locale) => [
        locale,
        locale === 'pt' ? `${key} nota somente em pt` : null,
      ]),
    ),
    sequence: options.index,
    reference: options.index === 0 ? null : options.recordIds[options.index - 1],
    comment_log: Object.fromEntries(
      options.locales.map((locale) => [
        locale,
        JSON.stringify(
          Array.from({ length: options.index === 0 ? 4 : 1 }, (_, rootIndex) =>
            makeRoot(options, locale, rootIndex),
          ),
        ),
      ]),
    ),
  };
}

export function recordIdForIndex(index: number) {
  requireQa(Number.isInteger(index) && index >= 0 && index < SOURCE_COUNT, 'source ID index is outside the fixture set');
  const bytes = (md5(`${PREFIX}:source:${index}`).match(/../g) ?? []).map((byte) => Number.parseInt(byte, 16));
  // CMA validates the UUID version/variant bits in its URL-safe entity IDs.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return btoa(
    String.fromCharCode(...bytes),
  )
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

export function createQaRecordIds() {
  return Array.from({ length: SOURCE_COUNT }, (_, index) => recordIdForIndex(index));
}

export function buildLegacyModel(modelId: string, fieldId: string): LegacyModel {
  return {
    modelId,
    fieldId,
    modelName: PREFIX,
    modelApiKey: MODEL_API_KEY,
    localized: true,
  };
}

export function expectedQaCounts(locales: string[]) {
  validateLocales(locales);
  const roots = 32 + (SOURCE_COUNT - 1) * locales.length;
  const replies = 130 + (SOURCE_COUNT - 1) * locales.length;
  return {
    sources: SOURCE_COUNT,
    aggregates: SOURCE_COUNT,
    newRecordsAfterMigration: SOURCE_COUNT * 2,
    roots,
    replies,
    nodes: roots + replies,
    votes: roots * 2 + replies,
    predecessorLinks: SOURCE_COUNT - 1,
    fieldMentions: roots,
    recordMentions: (SOURCE_COUNT - 1) * locales.length,
  };
}

function attributesOf(record: QaRecord): Record<string, unknown> {
  const attributes = record.attributes;
  return attributes && typeof attributes === 'object' && !Array.isArray(attributes)
    ? (attributes as Record<string, unknown>)
    : record;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

/** Verify every non-comment source field and the complete source locale JSON. */
export function verifySourceRecord(options: QaFixtureOptions, record: QaRecord) {
  const expected = createSourcePayload(options);
  const actual = attributesOf(record);
  requireQa(record.id === expected.id, 'source record ID changed');
  const localizedNotes = actual.single_locale_note;
  requireQa(
    localizedNotes && typeof localizedNotes === 'object' && !Array.isArray(localizedNotes),
    `${record.id}: source single_locale_note changed`,
  );
  const actualNotes = localizedNotes as Record<string, unknown>;
  requireQa(
    Object.keys(actualNotes).every((locale) => options.locales.includes(locale)),
    `${record.id}: source single_locale_note has an unexpected locale`,
  );
  for (const locale of options.locales) {
    const expectedNote = expected.single_locale_note[locale];
    const actualNote = actualNotes[locale];
    requireQa(
      expectedNote === null
        ? actualNote === undefined || actualNote === null || actualNote === ''
        : actualNote === expectedNote,
      `${record.id}: source single_locale_note changed in ${locale}`,
    );
  }
  const localizedLog = actual.comment_log;
  requireQa(
    localizedLog && typeof localizedLog === 'object' && !Array.isArray(localizedLog),
    `${record.id}: source comment_log changed`,
  );
  const actualLog = localizedLog as Record<string, unknown>;
  requireQa(
    canonical(Object.keys(actualLog).sort()) === canonical([...options.locales].sort()),
    `${record.id}: source comment_log locales changed`,
  );
  for (const locale of options.locales) {
    const actualValue = actualLog[locale];
    requireQa(
      typeof actualValue === 'string',
      `${record.id}: source comment_log JSON missing in ${locale}`,
    );
    let actualComments: unknown;
    try {
      actualComments = JSON.parse(actualValue);
    } catch {
      throw new Error(`Record comments live QA: ${record.id}: source comment_log JSON malformed in ${locale}`);
    }
    const expectedComments: unknown = JSON.parse(expected.comment_log[locale]);
    requireQa(
      canonical(actualComments) === canonical(expectedComments),
      `${record.id}: source comment_log content changed in ${locale}`,
    );
  }
  for (const field of [
    'title',
    'summary',
    'sequence',
    'reference',
  ] as const) {
    requireQa(
      canonical(actual[field]) === canonical(expected[field]),
      `${record.id}: source ${field} changed`,
    );
  }
  return { id: record.id, index: options.index, reference: expected.reference };
}

function decodeComments(value: unknown): CommentType[] {
  const comments: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  requireQa(isValidCommentArray(comments), 'aggregate comments are malformed');
  return comments as CommentType[];
}

export function inspectComments(value: unknown) {
  const comments = decodeComments(value);
  const ids = new Set<string>();
  const locales: Record<string, { roots: number; replies: number; votes: number }> = {};
  const stack = comments.map((comment) => ({ comment, parentId: undefined as string | undefined }));
  let replies = 0;
  let votes = 0;
  while (stack.length) {
    const next = stack.pop();
    if (!next) break;
    const metadata = next.comment as CommentType & { legacyLocale?: unknown };
    requireQa(!ids.has(next.comment.id), 'duplicate comment ID');
    ids.add(next.comment.id);
    requireQa(typeof metadata.legacyLocale === 'string', 'locale metadata missing');
    const stats = locales[metadata.legacyLocale] ??= { roots: 0, replies: 0, votes: 0 };
    if (next.parentId === undefined) {
      stats.roots++;
      requireQa(next.comment.parentCommentId === undefined, 'root has a parent');
    } else {
      replies++;
      stats.replies++;
      requireQa(next.comment.parentCommentId === next.parentId, 'reply parent was rewritten incorrectly');
    }
    votes += next.comment.upvoterIds.length;
    stats.votes += next.comment.upvoterIds.length;
    for (const reply of next.comment.replies ?? [])
      stack.push({ comment: reply, parentId: next.comment.id });
  }
  return { roots: comments.length, replies, nodes: ids.size, votes, locales };
}

/** Run before modifying the sentinel through UI; legitimate edits then change the expected baseline. */
export function verifyAggregateRecord(
  options: QaFixtureOptions,
  source: QaRecord,
  destination: QaRecord,
  userIdsByEmail = new Map([[options.currentUser.email.toLowerCase(), options.currentUser.id]]),
) {
  verifySourceRecord(options, source);
  const actual = attributesOf(destination);
  requireQa(actual.model_id === options.modelId, 'aggregate model_id mismatch');
  requireQa(actual.record_id === source.id, 'aggregate record_id mismatch');
  const expected = prepareLegacyComments(attributesOf(source).comment_log, true, userIdsByEmail);
  assertMigrationMatches(expected, actual.content);
  const stats = inspectComments(actual.content);
  requireQa(Object.keys(stats.locales).length === 8, 'aggregate locale count mismatch');
  for (const locale of options.locales) {
    const localeStats = stats.locales[locale];
    const roots = options.index === 0 ? 4 : 1;
    const replies = options.index === 0 ? (locale === 'en' ? 130 : 0) : 1;
    requireQa(localeStats?.roots === roots, `${locale}: root count mismatch`);
    requireQa(localeStats?.replies === replies, `${locale}: reply count mismatch`);
    requireQa(localeStats?.votes === roots * 2 + replies, `${locale}: vote count mismatch`);
  }
  return stats;
}

export function verifyMigrationCounters(
  results: MigrationResults,
  phase: 'first' | 'repeat' | 'verify',
) {
  requireQa(results.success === (phase === 'first' ? SOURCE_COUNT : 0), 'migration success count mismatch');
  requireQa(results.skipped === (phase === 'first' ? 0 : SOURCE_COUNT), 'migration skipped count mismatch');
  requireQa(results.empty === 0 && results.failed === 0 && results.errors.length === 0, 'migration had empty or failed fixtures');
}
