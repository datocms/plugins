import type { Client } from '@datocms/cma-client-browser';
import { readCurrentVersion } from '../selection/traversal';
import type { SchemaIndex } from '../selection/types';
import {
  classifyWriteError,
  isNotFoundError,
  type WriteFailDetail,
  type WriteFailReason,
} from './writeErrors';

/** Why a record was left unpublished although it was offered. */
export type PublishSkipReason =
  /** Edited after the replacement: publishing would publish that edit too. */
  | 'changed'
  /** Deleted after the replacement. */
  | 'deleted';

export type RecordPublishOutcome =
  | { status: 'published' }
  | { status: 'skipped'; reason: PublishSkipReason }
  | {
      status: 'failed';
      reason: WriteFailReason;
      retryable: boolean;
      detail: WriteFailDetail | null;
    };

export type PublishRecordArgs = {
  client: Client;
  schema: SchemaIndex;
  recordId: string;
  /** The version the replacement's update produced. */
  expectedVersion: string;
};

function failed(error: unknown, schema: SchemaIndex): RecordPublishOutcome {
  if (isNotFoundError(error)) return { status: 'skipped', reason: 'deleted' };
  return { status: 'failed', ...classifyWriteError(error, schema) };
}

/**
 * Publishes a record the replacement just updated, and nothing else:
 *
 * 1. Reads the record's current version. If it moved past the version the
 *    replacement produced, someone edited it since, and publishing would put
 *    their edit live too: skipped `changed`.
 * 2. Publishes the whole record (every locale), which is what the record
 *    already was before the replacement.
 *
 * The caller only offers records that were `published` right before the
 * replacement, so the replacement is the only change that goes live.
 */
export async function publishRecord(
  args: PublishRecordArgs,
): Promise<RecordPublishOutcome> {
  const { client, recordId, schema } = args;

  let currentVersion: string | null;
  try {
    const current = await client.items.find(recordId, { version: 'current' });
    currentVersion = readCurrentVersion(current as Record<string, unknown>);
  } catch (error) {
    return failed(error, schema);
  }
  if (currentVersion !== args.expectedVersion) {
    return { status: 'skipped', reason: 'changed' };
  }

  try {
    await client.items.publish(recordId);
  } catch (error) {
    return failed(error, schema);
  }
  return { status: 'published' };
}
