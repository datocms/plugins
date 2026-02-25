import type {
  ImportCheckpoint,
  ImportExecutionPhase,
  JsonObject,
  RecordExportEnvelope,
} from './types';

const CHECKPOINT_STORAGE_KEY = 'datocms.backup-importer.checkpoint.v1';

function localStorageAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.localStorage !== 'undefined'
  );
}

function hashString(input: string): string {
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash +=
      (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

function extractRecordId(record: JsonObject): string | null {
  const id = record.id;
  if (typeof id === 'string') {
    return id;
  }

  if (id && typeof id === 'object') {
    const nestedId = (id as Record<string, unknown>).id;
    return typeof nestedId === 'string' ? nestedId : null;
  }

  return null;
}

export function buildEnvelopeFingerprint(envelope: RecordExportEnvelope): string {
  const recordIds = envelope.records
    .map((record) => extractRecordId(record))
    .filter((id): id is string => Boolean(id));

  const seed = JSON.stringify({
    exportVersion: envelope.manifest.exportVersion,
    sourceProjectId: envelope.manifest.sourceProjectId,
    sourceEnvironment: envelope.manifest.sourceEnvironment,
    exportedAt: envelope.manifest.exportedAt,
    recordCount: recordIds.length,
    firstRecordId: recordIds[0] ?? null,
    lastRecordId: recordIds[recordIds.length - 1] ?? null,
  });

  return hashString(seed);
}

function readAllCheckpoints(): Record<string, ImportCheckpoint> {
  if (!localStorageAvailable()) {
    return {};
  }

  try {
    const rawValue = window.localStorage.getItem(CHECKPOINT_STORAGE_KEY);
    if (!rawValue) {
      return {};
    }

    const parsed = JSON.parse(rawValue) as Record<string, ImportCheckpoint>;
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }

    return parsed;
  } catch (_error) {
    return {};
  }
}

function writeAllCheckpoints(value: Record<string, ImportCheckpoint>) {
  if (!localStorageAvailable()) {
    return;
  }

  try {
    window.localStorage.setItem(CHECKPOINT_STORAGE_KEY, JSON.stringify(value));
  } catch (_error) {
    // Ignore storage errors to avoid blocking imports.
  }
}

export function readCheckpoint(fingerprint: string): ImportCheckpoint | null {
  const all = readAllCheckpoints();
  return all[fingerprint] ?? null;
}

export function persistCheckpoint(checkpoint: ImportCheckpoint): void {
  const all = readAllCheckpoints();
  all[checkpoint.fingerprint] = checkpoint;
  writeAllCheckpoints(all);
}

export function clearCheckpoint(fingerprint: string): void {
  const all = readAllCheckpoints();
  if (!(fingerprint in all)) {
    return;
  }

  delete all[fingerprint];
  writeAllCheckpoints(all);
}

export function buildCheckpoint(args: {
  fingerprint: string;
  strictMode: boolean;
  phase: ImportExecutionPhase;
  itemTypeIdMap: Map<string, string>;
  fieldIdMap: Map<string, string>;
  fieldsetIdMap: Map<string, string>;
  recordIdMap: Map<string, string>;
  uploadIdMap: Map<string, string>;
  blockIdMap: Map<string, string>;
  createdSourceRecordIds: Set<string>;
  updatedSourceRecordIds: Set<string>;
  publishedSourceRecordIds: Set<string>;
  treeUpdatedSourceRecordIds: Set<string>;
}): ImportCheckpoint {
  return {
    fingerprint: args.fingerprint,
    strictMode: args.strictMode,
    phase: args.phase,
    savedAt: new Date().toISOString(),
    itemTypeIdMap: Array.from(args.itemTypeIdMap.entries()),
    fieldIdMap: Array.from(args.fieldIdMap.entries()),
    fieldsetIdMap: Array.from(args.fieldsetIdMap.entries()),
    recordIdMap: Array.from(args.recordIdMap.entries()),
    uploadIdMap: Array.from(args.uploadIdMap.entries()),
    blockIdMap: Array.from(args.blockIdMap.entries()),
    createdSourceRecordIds: Array.from(args.createdSourceRecordIds),
    updatedSourceRecordIds: Array.from(args.updatedSourceRecordIds),
    publishedSourceRecordIds: Array.from(args.publishedSourceRecordIds),
    treeUpdatedSourceRecordIds: Array.from(args.treeUpdatedSourceRecordIds),
  };
}
