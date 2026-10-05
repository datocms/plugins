import type { CommentType } from '@ctypes/comments';
import type { Client } from '@datocms/cma-client-browser';
import { isQuotaOrBillingError } from '@utils/errorCategorization';
import {
  commentIdWasMigrated,
  type MigratedComment,
  migrateCommentsToUuid,
  normalizeCommentIfValid,
} from '@utils/migrations';
import { isValidCommentArray } from '@utils/typeGuards';

export const MIGRATION_PAGE_SIZE = 100;
export const MAX_MIGRATION_DETAILS = 20;

export type LegacyModel = {
  modelId: string;
  modelName: string;
  modelApiKey: string;
  fieldId: string;
  localized?: boolean;
};

export type MigrationResults = {
  success: number;
  skipped: number;
  empty: number;
  failed: number;
  errors: string[];
};

export type MigrationProgress = {
  currentModel: string;
  currentRecord: number;
  totalRecords: number;
  processedModels: number;
  totalModels: number;
};

export type MigrationOptions = {
  client: Client;
  commentsModelId: string;
  models: LegacyModel[];
  userIdsByEmail: Map<string, string>;
  signal: AbortSignal;
  onProgress: (progress: MigrationProgress) => void;
  verifyOnly?: boolean;
  onModelVerified?: (model: LegacyModel) => Promise<void>;
};

function checkActive(signal: AbortSignal) {
  if (signal.aborted)
    throw new Error(
      'Migration stopped because the screen was closed. Legacy fields were preserved.',
    );
}

function parseArray(value: unknown): unknown[] {
  if (value == null || value === '') return [];
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(parsed))
    throw new Error(
      'comment_log is not a JSON array; no comments were discarded.',
    );
  return parsed;
}

/** Ambiguous emails retain their legacy identity instead of selecting an arbitrary account. */
export function buildLegacyUserIdsByEmail(
  users: Array<{ id: string; email: string }>,
): Map<string, string> {
  const userIdsByEmail = new Map<string, string>();
  const ambiguousEmails = new Set<string>();
  for (const user of users) {
    const email = user.email.toLowerCase();
    if (ambiguousEmails.has(email)) continue;
    const previousId = userIdsByEmail.get(email);
    if (previousId !== undefined && previousId !== user.id) {
      userIdsByEmail.delete(email);
      ambiguousEmails.add(email);
      continue;
    }
    userIdsByEmail.set(email, user.id);
  }
  return userIdsByEmail;
}

function resolveLegacyUser(email: string, userIdsByEmail: Map<string, string>) {
  return (
    userIdsByEmail.get(email.toLowerCase()) ??
    `legacy-email:${encodeURIComponent(email)}`
  );
}

function legacyLocaleValues(
  value: unknown,
  localized: boolean,
): Array<[string | undefined, unknown]> {
  if (!localized || value == null) return [[undefined, value]];
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Localized comment_log is malformed.');
  }
  return Object.entries(value as Record<string, unknown>);
}

function normalizedLegacyArray(value: unknown): MigratedComment[] {
  const normalized = parseArray(value).map((comment) => {
    const result = normalizeCommentIfValid(comment);
    if (!result)
      throw new Error(
        'A legacy comment or reply is malformed; the complete record was preserved.',
      );
    return result;
  });
  return migrateCommentsToUuid(normalized).comments;
}

function populateLegacyActors(
  target: Record<string, unknown>,
  userIdsByEmail: Map<string, string>,
) {
  if (typeof target.authorId !== 'string') {
    if (typeof target.authorEmail !== 'string' || !target.authorEmail)
      throw new Error('Legacy author is missing.');
    target.authorId = resolveLegacyUser(target.authorEmail, userIdsByEmail);
  }
  if (!Array.isArray(target.upvoterIds)) {
    if (!Array.isArray(target.upvoterEmails))
      throw new Error('Legacy votes are malformed.');
    target.upvoterIds = target.upvoterEmails.map((email: string) =>
      resolveLegacyUser(email, userIdsByEmail),
    );
  }
  assertLegacyActorIds(target, userIdsByEmail);
}

function assertLegacyActorIds(
  target: Record<string, unknown>,
  userIdsByEmail: Map<string, string>,
) {
  if (
    typeof target.authorEmail === 'string' &&
    target.authorId !== resolveLegacyUser(target.authorEmail, userIdsByEmail)
  ) {
    throw new Error('Legacy author email conflicts with the existing user ID.');
  }
  if (!Array.isArray(target.upvoterEmails)) return;
  const expected = target.upvoterEmails.map((email: string) =>
    resolveLegacyUser(email, userIdsByEmail),
  );
  const ids = target.upvoterIds;
  if (
    !Array.isArray(ids) ||
    ids.length !== expected.length ||
    expected.some((id, index) => id !== ids[index])
  ) {
    throw new Error('Legacy voter emails conflict with the existing user IDs.');
  }
}

function prepareLegacyTree(
  comments: MigratedComment[],
  locale: string | undefined,
  userIdsByEmail: Map<string, string>,
) {
  const stack = [...comments];
  while (stack.length) {
    const comment = stack.pop();
    if (!comment) break;
    const target = comment as unknown as Record<string, unknown>;
    populateLegacyActors(target, userIdsByEmail);
    if (typeof target.content === 'string')
      target.content = [{ type: 'text', content: target.content }];
    if (locale !== undefined) {
      if (target.legacyLocale !== undefined && target.legacyLocale !== locale)
        throw new Error(
          'Legacy locale metadata conflicts with its source locale.',
        );
      target.legacyLocale = locale;
    }
    for (const reply of comment.replies ?? []) stack.push(reply);
  }
}

function validatePreparedComments(output: CommentType[]) {
  if (!isValidCommentArray(output))
    throw new Error(
      'Legacy comments cannot be represented by the current comment format.',
    );
  const ids = new Set<string>();
  const stack = [...output];
  while (stack.length) {
    const comment = stack.pop();
    if (!comment) break;
    if (ids.has(comment.id))
      throw new Error('Duplicate comment IDs across locales.');
    ids.add(comment.id);
    for (const reply of comment.replies ?? []) stack.push(reply);
  }
}

/** Converts every node, preserving the original author/vote metadata and all locales. */
export function prepareLegacyComments(
  value: unknown,
  localized: boolean,
  userIdsByEmail: Map<string, string>,
): CommentType[] {
  const output: CommentType[] = [];
  for (const [locale, raw] of legacyLocaleValues(value, localized)) {
    const migrated = normalizedLegacyArray(raw);
    prepareLegacyTree(migrated, locale, userIdsByEmail);
    for (const comment of migrated)
      output.push(comment as unknown as CommentType);
  }
  validatePreparedComments(output);
  return output;
}

function parseDestination(value: unknown): CommentType[] {
  const parsed = parseArray(value);
  if (!isValidCommentArray(parsed))
    throw new Error(
      'Existing destination comments are malformed or use an incompatible format.',
    );
  return parsed as CommentType[];
}

type IndexedComment = {
  comment: CommentType;
  structuralParent: number | null;
  siblingIndex: number;
};

function indexCommentTree(comments: CommentType[]) {
  const nodes: IndexedComment[] = comments.map((comment, siblingIndex) => ({
    comment,
    structuralParent: null,
    siblingIndex,
  }));
  const indices = new Map<string, number>();
  for (let index = 0; index < nodes.length; index++) {
    const { comment } = nodes[index];
    if (indices.has(comment.id))
      throw new Error('Destination has duplicate comment IDs.');
    indices.set(comment.id, index);
    for (const [replyIndex, reply] of (comment.replies ?? []).entries())
      nodes.push({
        comment: reply,
        structuralParent: index,
        siblingIndex: replyIndex,
      });
  }
  return { nodes, indices };
}

/** Numeric traversal positions preserve tree topology with linear memory use. */
function commentKeys(comments: CommentType[], sourceGeneratedIds?: boolean[]) {
  const keys: string[] = [];
  const { nodes, indices } = indexCommentTree(comments);
  const generatedIds = nodes.map(({ comment }) =>
    commentIdWasMigrated(comment),
  );
  for (const [
    index,
    { comment, structuralParent, siblingIndex },
  ] of nodes.entries()) {
    const { id: _id, replies: _replies, parentCommentId, ...data } = comment;
    const parentIndex =
      parentCommentId === undefined ? null : indices.get(parentCommentId);
    if (parentIndex === undefined)
      throw new Error('A parent reference is missing from the destination.');
    const ignoreId = (sourceGeneratedIds ?? generatedIds)[index] ?? false;
    keys.push(
      JSON.stringify([
        structuralParent,
        siblingIndex,
        parentIndex,
        ignoreId ? null : comment.id,
        Object.fromEntries(
          Object.entries(data).sort(([a], [b]) => a.localeCompare(b)),
        ),
      ]),
    );
  }
  return { keys, generatedIds };
}

export function assertMigrationMatches(
  source: CommentType[],
  destination: unknown,
) {
  const actual = parseDestination(destination);
  const expected = commentKeys(source);
  const expectedKeys = expected.keys;
  const actualKeys = commentKeys(actual, expected.generatedIds).keys;
  if (
    expectedKeys.length !== actualKeys.length ||
    expectedKeys.some((key, index) => key !== actualKeys[index])
  ) {
    throw new Error(
      'Existing destination differs from the legacy comments. Legacy fields cannot be deleted.',
    );
  }
}

type Destination = Awaited<ReturnType<Client['items']['list']>>[number];

async function createVerifiedDestination(
  options: MigrationOptions,
  model: LegacyModel,
  recordId: string,
  comments: CommentType[],
) {
  const { client, commentsModelId, signal } = options;
  checkActive(signal);
  const created = await client.items.create({
    item_type: { type: 'item_type' as const, id: commentsModelId },
    model_id: model.modelId,
    record_id: recordId,
    content: JSON.stringify(comments),
  });
  assertMigrationMatches(comments, created.content);
}

async function destinationsForPage(
  options: MigrationOptions,
  ids: string[],
): Promise<Map<string, Destination>> {
  const destinations = new Map<string, Destination>();
  const { client, commentsModelId } = options;
  const page = await client.items.rawList({
    filter: { type: commentsModelId, fields: { record_id: { in: ids } } },
    page: { limit: MIGRATION_PAGE_SIZE },
  });
  if (page.meta.total_count > ids.length)
    throw new Error(
      'Duplicate destination record_id values; cleanup is blocked.',
    );
  // The unique record_id field guarantees no more than one page of destinations.
  for (const raw of page.data) {
    const recordId = raw.attributes.record_id;
    if (typeof recordId !== 'string' || destinations.has(recordId))
      throw new Error('Destination identity is malformed or duplicated.');
    destinations.set(recordId, {
      id: raw.id,
      ...raw.attributes,
    } as Destination);
  }
  return destinations;
}

async function processPageRecord(
  options: MigrationOptions,
  model: LegacyModel,
  raw: { id: string; attributes: Record<string, unknown> },
  destination: Destination | undefined,
  results: MigrationResults,
) {
  try {
    const comments = prepareLegacyComments(
      raw.attributes.comment_log,
      model.localized ?? false,
      options.userIdsByEmail,
    );
    if (comments.length === 0) {
      results.empty++;
      return;
    }
    if (destination) {
      if (destination.model_id !== model.modelId)
        throw new Error('Destination belongs to a different model.');
      assertMigrationMatches(comments, destination.content);
      results.skipped++;
    } else if (options.verifyOnly) {
      throw new Error('Legacy comments have no verified destination.');
    } else {
      await createVerifiedDestination(options, model, raw.id, comments);
      results.success++;
    }
  } catch (error) {
    checkActive(options.signal);
    if (isQuotaOrBillingError(error)) throw error;
    results.failed++;
    if (results.errors.length < MAX_MIGRATION_DETAILS)
      results.errors.push(
        `Record ${raw.id} in ${model.modelName}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
  }
}

type StorageField = Awaited<ReturnType<Client['fields']['list']>>[number];
type SourcePage = Awaited<ReturnType<Client['items']['rawList']>>;
type ModelScanPosition = { offset: number; total?: number };

function requireStorageField(
  fields: StorageField[],
  apiKey: string,
  fieldType: string,
  message: string,
): StorageField {
  const field = fields.find((entry) => entry.api_key === apiKey);
  if (!field || field.localized || field.field_type !== fieldType)
    throw new Error(message);
  return field;
}

async function validateCommentStorage(options: MigrationOptions) {
  const { client, commentsModelId } = options;
  const fields = await client.fields.list(commentsModelId);
  const identityMessage =
    'Comment storage requires a non-localized unique record_id field.';
  const identity = requireStorageField(
    fields,
    'record_id',
    'string',
    identityMessage,
  );
  if (!('unique' in identity.validators) || !identity.validators.unique)
    throw new Error(identityMessage);
  requireStorageField(
    fields,
    'content',
    'json',
    'Comment storage requires a non-localized JSON content field.',
  );
  requireStorageField(
    fields,
    'model_id',
    'string',
    'Comment storage requires a non-localized string model_id field.',
  );
}

function readSourceRevision(options: MigrationOptions, model: LegacyModel) {
  return options.client.items.rawList({
    filter: { type: model.modelId },
    version: 'current',
    order_by: '_updated_at_DESC',
    page: { limit: 1 },
  });
}

function readSourcePage(
  options: MigrationOptions,
  model: LegacyModel,
  offset: number,
) {
  return options.client.items.rawList({
    filter: { type: model.modelId },
    version: 'current',
    order_by: 'id_ASC',
    page: { offset, limit: MIGRATION_PAGE_SIZE },
  });
}

function hasRecordsToInspect(
  page: SourcePage,
  model: LegacyModel,
  position: ModelScanPosition,
): boolean {
  position.total ??= page.meta.total_count;
  if (position.total !== page.meta.total_count)
    throw new Error(
      `Record count changed in ${model.modelName}; legacy fields were preserved.`,
    );
  if (page.data.length > 0) return true;
  if (position.offset !== position.total)
    throw new Error('Pagination ended before all records were inspected.');
  return false;
}

function reportModelProgress(
  options: MigrationOptions,
  model: LegacyModel,
  modelIndex: number,
  position: ModelScanPosition,
) {
  options.onProgress({
    currentModel: model.modelName,
    currentRecord: position.offset,
    totalRecords: position.total ?? 0,
    processedModels: modelIndex,
    totalModels: options.models.length,
  });
}

async function processSourcePage(
  options: MigrationOptions,
  model: LegacyModel,
  modelIndex: number,
  page: SourcePage,
  position: ModelScanPosition,
  results: MigrationResults,
) {
  const destinations = await destinationsForPage(
    options,
    page.data.map((record) => record.id),
  );
  for (const raw of page.data) {
    checkActive(options.signal);
    // biome-ignore lint/performance/noAwaitInLoops: Bound API concurrency and retained record payloads.
    await processPageRecord(
      options,
      model,
      raw,
      destinations.get(raw.id),
      results,
    );
    position.offset++;
    if (position.offset % 10 === 0 || position.offset === position.total)
      reportModelProgress(options, model, modelIndex, position);
  }
}

async function scanModelRecords(
  options: MigrationOptions,
  model: LegacyModel,
  modelIndex: number,
  results: MigrationResults,
): Promise<ModelScanPosition> {
  const position: ModelScanPosition = { offset: 0 };
  while (true) {
    checkActive(options.signal);
    // biome-ignore lint/performance/noAwaitInLoops: The next offset depends on processing the preceding page.
    const page = await readSourcePage(options, model, position.offset);
    if (!hasRecordsToInspect(page, model, position)) break;
    await processSourcePage(
      options,
      model,
      modelIndex,
      page,
      position,
      results,
    );
    if (position.offset === position.total) break;
    if (position.offset > (position.total ?? 0))
      throw new Error('Pagination returned more records than expected.');
  }
  return position;
}

function assertSourceUnchanged(
  sourceRevision: SourcePage | undefined,
  latestRevision: SourcePage,
  model: LegacyModel,
) {
  const before = sourceRevision?.data[0];
  const after = latestRevision.data[0];
  if (
    sourceRevision?.meta.total_count !== latestRevision.meta.total_count ||
    before?.id !== after?.id ||
    before?.meta?.updated_at !== after?.meta?.updated_at
  )
    throw new Error(
      `Records changed during verification in ${model.modelName}; legacy fields were preserved.`,
    );
}

async function verifyModelCompletion(
  options: MigrationOptions,
  model: LegacyModel,
  initialFailed: number,
  results: MigrationResults,
  sourceRevision: SourcePage | undefined,
) {
  if (results.failed !== initialFailed || !options.onModelVerified) return;
  const latestRevision = await readSourceRevision(options, model);
  assertSourceUnchanged(sourceRevision, latestRevision, model);
  await options.onModelVerified(model);
}

export async function runLegacyMigration(
  options: MigrationOptions,
  results: MigrationResults,
) {
  await validateCommentStorage(options);
  for (const [modelIndex, model] of options.models.entries()) {
    const initialFailed = results.failed;
    // Detect source edits behind the current offset; final field deletion is not atomic.
    let sourceRevision: SourcePage | undefined;
    if (options.verifyOnly) {
      // biome-ignore lint/performance/noAwaitInLoops: Verify each model fully before allowing its field deletion.
      sourceRevision = await readSourceRevision(options, model);
    }
    const position = await scanModelRecords(
      options,
      model,
      modelIndex,
      results,
    );
    reportModelProgress(options, model, modelIndex, position);
    await verifyModelCompletion(
      options,
      model,
      initialFailed,
      results,
      sourceRevision,
    );
  }
}

export function emptyMigrationResults(): MigrationResults {
  return { success: 0, skipped: 0, empty: 0, failed: 0, errors: [] };
}
