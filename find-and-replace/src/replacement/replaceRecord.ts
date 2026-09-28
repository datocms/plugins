import type { ApiTypes, Client } from '@datocms/cma-client-browser';
import type { DiscoveredTarget } from '../selection/discoverTargets';
import {
  selectionTargetFieldValue,
  stableSerialize,
} from '../selection/identity';
import { modelRecordTitle } from '../selection/labels';
import {
  ownerAttributes,
  readCurrentVersion,
  readItemId,
  type TraversableRecord,
} from '../selection/traversal';
import type { PublicationStatus, SchemaIndex } from '../selection/types';
import {
  compileRootUpdateAttributes,
  NestedPayloadCompilationError,
} from './payloadCompiler';
import {
  type PreparedRootChanges,
  prepareRootChanges,
  RootReplacementError,
} from './replacementPlanning';
import type { ReplacementTemplate } from './replacementTemplate';
import {
  classifyWriteError,
  isNotFoundError,
  isStaleItemVersionError,
  type WriteFailDetail,
  type WriteFailReason,
} from './writeErrors';

/** Why a record was left as it was (same vocabulary as the page contract). */
export type WriteSkipReason = 'stale' | 'deleted' | 'unsupported';

/**
 * An update that was sent but answered with an error that doesn't prove it
 * was refused (a gateway error page after the backend committed, a dropped
 * connection): it may have landed.
 */
export type UnconfirmedWrite = {
  /** The attributes the update sent (as compiled). */
  attributes: Readonly<Record<string, unknown>>;
  replacedMatches: number;
  /** The record's publication status right before the update. */
  statusBefore: PublicationStatus | null;
};

/**
 * What publishing the record afterwards needs to know: publishing is safe
 * only when the replacement is its only unpublished change (it was
 * `published` right before the write), and only while the record is still at
 * the version the write produced.
 */
export type WritePublication = {
  statusBefore: PublicationStatus | null;
  versionAfter: string | null;
};

export type RecordWriteOutcome =
  | {
      status: 'replaced';
      replacedMatches: number;
      freshTitle: string | null;
      publication: WritePublication;
    }
  | { status: 'skipped'; reason: WriteSkipReason }
  | {
      status: 'failed';
      reason: WriteFailReason;
      retryable: boolean;
      detail: WriteFailDetail | null;
      /** Set when the update was sent and may have landed (retryable failures only). */
      unconfirmed?: UnconfirmedWrite;
    };

export type ReplaceInRecordArgs = {
  client: Client;
  schema: SchemaIndex;
  siteId: string;
  environment: string;
  /** Site locales, in site order (fresh title). */
  locales: ReadonlyArray<string>;
  /**
   * The changing exact-match targets of ONE root record (included, not
   * no-ops), as discovered.
   */
  entries: ReadonlyArray<DiscoveredTarget>;
  /** Expanded per match, exactly like the preview. */
  template: ReplacementTemplate;
  /**
   * The update of an earlier attempt that may have landed ("Try again"):
   * when the fresh record already holds what it sent, the record is reported
   * replaced and nothing is written again.
   */
  unconfirmed?: UnconfirmedWrite | null;
};

type UnknownRecord = Record<string, unknown>;

type DynamicItemBody = Record<string, unknown> & {
  meta: { current_version: string };
};

const FRESH_READ = { nested: true, version: 'current' } as const;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function readStatus(record: object): PublicationStatus | null {
  const status = asRecord(asRecord(record)?.meta)?.status;
  return status === 'draft' || status === 'updated' || status === 'published'
    ? status
    : null;
}

function skipped(reason: WriteSkipReason): RecordWriteOutcome {
  return { status: 'skipped', reason };
}

function failed(error: unknown, schema: SchemaIndex): RecordWriteOutcome {
  return { status: 'failed', ...classifyWriteError(error, schema) };
}

async function readFresh(
  client: Client,
  recordId: string,
): Promise<TraversableRecord> {
  const response = await client.items.rawFind(recordId, FRESH_READ);
  return response.data as TraversableRecord;
}

/** A nested block record (as a fresh nested read returns it). */
function isNestedBlock(value: UnknownRecord): boolean {
  return readItemId(value) !== null && asRecord(value.attributes) !== null;
}

/**
 * Whether the value the update sent (`expected`, as compiled) is what the
 * record holds now (`actual`, from a nested read). Compiled payloads refer to
 * untouched blocks by ID and send only the dirty fields of changed blocks, so
 * blocks compare by ID plus their sent fields; every other leaf compares with
 * `stableSerialize`, and objects compare on the keys that were sent.
 */
function holdsSentValue(expected: unknown, actual: unknown): boolean {
  if (expected === null || expected === undefined) {
    return actual === null || actual === undefined;
  }
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((entry, index) => holdsSentValue(entry, actual[index]))
    );
  }

  const actualRecord = asRecord(actual);
  if (typeof expected === 'string') {
    if (typeof actual === 'string') return actual === expected;
    return (
      actualRecord !== null &&
      isNestedBlock(actualRecord) &&
      readItemId(actualRecord) === expected
    );
  }

  const expectedRecord = asRecord(expected);
  if (!expectedRecord) {
    return stableSerialize(expected) === stableSerialize(actual);
  }
  if (!actualRecord) return false;

  const sentBlockAttributes =
    expectedRecord.type === 'item' ? asRecord(expectedRecord.attributes) : null;
  if (sentBlockAttributes) {
    if (readItemId(actualRecord) !== readItemId(expectedRecord)) return false;
    const { attributes } = ownerAttributes(actualRecord, []);
    return Object.entries(sentBlockAttributes).every(([key, value]) =>
      holdsSentValue(value, attributes[key]),
    );
  }
  return Object.entries(expectedRecord).every(([key, value]) =>
    holdsSentValue(value, actualRecord[key]),
  );
}

function recordHoldsAttributes(
  record: TraversableRecord,
  attributes: Readonly<Record<string, unknown>>,
): boolean {
  const { attributes: current } = ownerAttributes(record as UnknownRecord, []);
  return Object.entries(attributes).every(([key, value]) =>
    holdsSentValue(value, current[key]),
  );
}

/** `replaced`, with the title and version of the record as it is now. */
function landed(
  args: ReplaceInRecordArgs,
  rootModelId: string,
  current: object,
  replacedMatches: number,
  statusBefore: PublicationStatus | null,
): RecordWriteOutcome {
  return {
    status: 'replaced',
    replacedMatches,
    freshTitle: modelRecordTitle(
      args.schema,
      rootModelId,
      current,
      args.locales,
    ),
    publication: {
      statusBefore,
      versionAfter: readCurrentVersion(current as UnknownRecord),
    },
  };
}

/**
 * The update was refused as stale. When the client timed out and retried a
 * PUT that had in fact landed, the retry fails exactly like this: read the
 * record again and report `replaced` if it already holds what was sent.
 */
async function settleStaleUpdate(
  args: ReplaceInRecordArgs,
  recordId: string,
  { prepared, attributes, statusBefore }: PlannedWrite,
): Promise<RecordWriteOutcome> {
  let current: TraversableRecord;
  try {
    current = await readFresh(args.client, recordId);
  } catch (error) {
    return isNotFoundError(error)
      ? skipped('deleted')
      : failed(error, args.schema);
  }
  if (!recordHoldsAttributes(current, attributes)) return skipped('stale');
  return landed(
    args,
    prepared.rootModelId,
    current,
    prepared.replacementCount,
    statusBefore,
  );
}

/**
 * Writes the replacement into one record, in a single pass:
 *
 * 1. Fresh read (`nested`, current version). 404 → skipped `deleted`.
 * 2. `prepareRootChanges` against that read: every selected field value must
 *    still be there, unchanged (fingerprint and presence); edits elsewhere in
 *    the record are fine. Otherwise skipped `stale` (or `unsupported`).
 * 3. The payload is compiled from the fresh record, and sent with its
 *    `meta.current_version`, so an edit that lands between the read and the
 *    update is refused by the server instead of being overwritten.
 * 4. A refused update (`STALE_ITEM_VERSION`) is read again: `replaced` if the
 *    record already holds the sent values (a retried request that had
 *    landed), else skipped `stale`.
 * 5. Any other failed update may still have landed: the outcome keeps what
 *    it sent (`unconfirmed`). "Try again" passes it back, and a fresh record
 *    that already holds it is `replaced` without a second write.
 *
 * Never publishes (see `publishRecord`), never validates separately, never
 * matches again: the targets carry their matches. A `replaced` outcome says
 * whether publishing afterwards would publish only this write.
 */
export async function replaceInRecord(
  args: ReplaceInRecordArgs,
): Promise<RecordWriteOutcome> {
  const [firstEntry] = args.entries;
  if (!firstEntry) return skipped('unsupported');
  const recordId = selectionTargetFieldValue(firstEntry.target).rootRecordId;

  let fresh: TraversableRecord;
  try {
    fresh = await readFresh(args.client, recordId);
  } catch (error) {
    return isNotFoundError(error)
      ? skipped('deleted')
      : failed(error, args.schema);
  }

  const { unconfirmed } = args;
  if (unconfirmed && recordHoldsAttributes(fresh, unconfirmed.attributes)) {
    return landed(
      args,
      selectionTargetFieldValue(firstEntry.target).rootModelId,
      fresh,
      unconfirmed.replacedMatches,
      unconfirmed.statusBefore,
    );
  }

  const write = await planWrite(args, fresh);
  if ('status' in write) return write;
  return sendUpdate(args, recordId, write);
}

type PlannedWrite = {
  prepared: PreparedRootChanges;
  attributes: Record<string, unknown>;
  /** The publication status of the fresh read the payload was compiled from. */
  statusBefore: PublicationStatus | null;
};

/** Checks the selection against the fresh record and compiles the payload. */
async function planWrite(
  args: ReplaceInRecordArgs,
  fresh: TraversableRecord,
): Promise<PlannedWrite | RecordWriteOutcome> {
  try {
    const prepared = await prepareRootChanges({
      root: fresh,
      entries: args.entries,
      schema: args.schema,
      siteId: args.siteId,
      environment: args.environment,
      locales: args.locales,
      replacement: args.template,
      strictRootVersion: false,
      // Exact-match targets carry their matches; anything that would need
      // matching again is not something this writer handles.
      matchField: () =>
        Promise.reject(
          new RootReplacementError(
            'unsupported',
            'Only exact matches can be replaced.',
          ),
        ),
    });
    if (prepared.changedValues.length === 0) return skipped('stale');
    const attributes = compileRootUpdateAttributes({
      root: fresh,
      schema: args.schema,
      changedValues: prepared.changedValues,
    });
    if (Object.keys(attributes).length === 0) return skipped('stale');
    return { prepared, attributes, statusBefore: readStatus(fresh) };
  } catch (error) {
    if (error instanceof RootReplacementError) {
      return skipped(error.kind === 'unsupported' ? 'unsupported' : 'stale');
    }
    if (error instanceof NestedPayloadCompilationError) {
      return skipped('stale');
    }
    return {
      status: 'failed',
      reason: 'unknown',
      retryable: false,
      detail: null,
    };
  }
}

/** The update, locked to the version of the fresh read. */
async function sendUpdate(
  args: ReplaceInRecordArgs,
  recordId: string,
  write: PlannedWrite,
): Promise<RecordWriteOutcome> {
  const { prepared, attributes, statusBefore } = write;
  const body: DynamicItemBody = {
    ...attributes,
    meta: { current_version: prepared.currentVersion },
  };
  try {
    const updated = await args.client.items.update(
      recordId,
      body as ApiTypes.ItemUpdateSchema,
    );
    return landed(
      args,
      prepared.rootModelId,
      updated,
      prepared.replacementCount,
      statusBefore,
    );
  } catch (error) {
    if (isStaleItemVersionError(error)) {
      return settleStaleUpdate(args, recordId, write);
    }
    if (isNotFoundError(error)) return skipped('deleted');
    const outcome = classifyWriteError(error, args.schema);
    return outcome.retryable
      ? {
          status: 'failed',
          ...outcome,
          unconfirmed: {
            attributes,
            replacedMatches: prepared.replacementCount,
            statusBefore,
          },
        }
      : { status: 'failed', ...outcome };
  }
}
