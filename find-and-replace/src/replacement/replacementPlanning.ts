import type { DiscoveredTarget } from '../selection/discoverTargets';
import {
  fieldValueIdentity,
  selectionTargetFieldValue,
  selectionTargetIdentity,
  stableSerialize,
} from '../selection/identity';
import {
  readCurrentVersion,
  readItemId,
  readItemModelId,
  type TraversableRecord,
  traverseRecordWithDiagnostics,
} from '../selection/traversal';
import type {
  ExactMatchRef,
  FieldValueRef,
  MatcherSpec,
  SchemaIndex,
  TraversedFieldValue,
} from '../selection/types';
import {
  type ReplacementTemplate,
  templateReplacer,
} from './replacementTemplate';
import type { ReplacementChange, ReplacementIssueKind } from './types';
import { replaceExactMatches } from './valueReplacement';

export type MatchReplacementField = (
  fieldValue: TraversedFieldValue,
  matcher: MatcherSpec,
  signal?: AbortSignal,
) => Promise<ExactMatchRef[]>;

export type ChangedFieldValue = {
  fieldValue: TraversedFieldValue;
  value: unknown;
};

export type PreparedRootChanges = {
  rootRecordId: string;
  rootModelId: string;
  currentVersion: string;
  /** Record title at search time; null when the record has none. */
  recordLabel: string | null;
  modelName: string;
  changedValues: ChangedFieldValue[];
  changes: ReplacementChange[];
  replacementCount: number;
  unchangedFieldCount: number;
};

export class RootReplacementError extends Error {
  constructor(
    public readonly kind: ReplacementIssueKind,
    message: string,
  ) {
    super(message);
    this.name = 'RootReplacementError';
  }
}

type FieldOperation =
  | {
      kind: 'matches';
      fieldValue: TraversedFieldValue;
      matches: ExactMatchRef[];
    }
  | {
      kind: 'matcher';
      fieldValue: TraversedFieldValue;
      matcher: MatcherSpec;
    };

function abortError(): DOMException {
  return new DOMException(
    'Replacement preparation was cancelled.',
    'AbortError',
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function displayLocale(fieldValue: TraversedFieldValue): string | null {
  if (fieldValue.ref.locale) return fieldValue.ref.locale;

  for (
    let index = fieldValue.ref.blockAncestry.length - 1;
    index >= 0;
    index -= 1
  ) {
    const locale = fieldValue.ref.blockAncestry[index]?.locale;
    if (locale) return locale;
  }

  return null;
}

function validateRootIdentity(args: {
  root: TraversableRecord;
  entries: ReadonlyArray<DiscoveredTarget>;
  firstRef: FieldValueRef;
  siteId: string;
  environment: string;
  strictRootVersion: boolean;
}): { rootRecordId: string; rootModelId: string; currentVersion: string } {
  const { firstRef } = args;
  const rootRecordId = readItemId(args.root as Record<string, unknown>);
  const rootModelId = readItemModelId(args.root as Record<string, unknown>);
  const currentVersion = readCurrentVersion(
    args.root as Record<string, unknown>,
  );

  if (
    !rootRecordId ||
    !rootModelId ||
    rootRecordId !== firstRef.rootRecordId ||
    rootModelId !== firstRef.rootModelId
  ) {
    throw new RootReplacementError(
      'stale',
      'This record changed shape after it was selected. Search for it again.',
    );
  }

  if (!currentVersion) {
    throw new RootReplacementError(
      'stale',
      'This record has no current version. Search for it again before replacing.',
    );
  }
  if (args.strictRootVersion) {
    const capturedVersions = new Set(
      args.entries.map(
        (entry) => selectionTargetFieldValue(entry.target).rootRecordVersion,
      ),
    );
    if (capturedVersions.size !== 1 || !capturedVersions.has(currentVersion)) {
      throw new RootReplacementError(
        'stale',
        'This record changed after it was selected. Search for it again before replacing.',
      );
    }
  }

  for (const entry of args.entries) {
    const ref = selectionTargetFieldValue(entry.target);
    if (
      ref.siteId !== args.siteId ||
      ref.environment !== args.environment ||
      ref.rootRecordId !== rootRecordId ||
      ref.rootModelId !== rootModelId
    ) {
      throw new RootReplacementError(
        'stale',
        'This selection belongs to different project content. Search again.',
      );
    }
  }

  return { rootRecordId, rootModelId, currentVersion };
}

type OperationContext = {
  freshById: ReadonlyMap<string, TraversedFieldValue>;
  freshFields: ReadonlyArray<TraversedFieldValue>;
  duplicateFieldValueIds: ReadonlySet<string>;
  operationsByFieldId: Map<string, FieldOperation>;
};

/** The fresh value of a selected field, if it is unchanged since the search. */
function unchangedFreshField(
  selectedRef: FieldValueRef,
  context: OperationContext,
): TraversedFieldValue {
  const selectedFieldId = fieldValueIdentity(selectedRef);
  if (context.duplicateFieldValueIds.has(selectedFieldId)) {
    throw new RootReplacementError(
      'stale',
      'A selected field is now ambiguous inside this record. Search for it again.',
    );
  }

  const freshSelectedField = context.freshById.get(selectedFieldId);
  if (
    !freshSelectedField ||
    freshSelectedField.ref.valueFingerprint !== selectedRef.valueFingerprint ||
    freshSelectedField.ref.present !== selectedRef.present
  ) {
    throw new RootReplacementError(
      'stale',
      'A selected field changed after the search. Search for it again before replacing.',
    );
  }
  return freshSelectedField;
}

function addExactMatchOperation(
  match: ExactMatchRef,
  freshField: TraversedFieldValue,
  context: OperationContext,
): void {
  const fieldId = fieldValueIdentity(match.fieldValue);
  const existing = context.operationsByFieldId.get(fieldId);
  if (existing?.kind === 'matcher') {
    throw new RootReplacementError(
      'stale',
      'This field has conflicting selections. Review the selection and try again.',
    );
  }
  context.operationsByFieldId.set(fieldId, {
    kind: 'matches',
    fieldValue: freshField,
    matches: [...(existing?.kind === 'matches' ? existing.matches : []), match],
  });
}

function addMatcherOperation(
  candidate: TraversedFieldValue,
  matcher: MatcherSpec,
  context: OperationContext,
): void {
  if (!candidate.field.exactMatchCompatible || !candidate.ref.present) return;

  const candidateId = fieldValueIdentity(candidate.ref);
  if (context.duplicateFieldValueIds.has(candidateId)) {
    throw new RootReplacementError(
      'stale',
      'A selected container now contains an ambiguous block. Search for it again.',
    );
  }
  const existing = context.operationsByFieldId.get(candidateId);
  if (!existing) {
    context.operationsByFieldId.set(candidateId, {
      kind: 'matcher',
      fieldValue: candidate,
      matcher,
    });
    return;
  }
  if (
    existing.kind !== 'matcher' ||
    stableSerialize(existing.matcher) !== stableSerialize(matcher)
  ) {
    throw new RootReplacementError(
      'stale',
      'This selection contains overlapping replacement rules. Review it and try again.',
    );
  }
}

/** A selected field value, plus its descendants when it is a container. */
function matcherCandidates(
  freshField: TraversedFieldValue,
  context: OperationContext,
): TraversedFieldValue[] {
  if (!freshField.isContainer) return [freshField];
  const fieldId = fieldValueIdentity(freshField.ref);
  return [
    freshField,
    ...context.freshFields.filter((fieldValue) =>
      fieldValue.ref.ancestorFieldValueIds.includes(fieldId),
    ),
  ];
}

function selectedFieldOperations(args: {
  entries: ReadonlyArray<DiscoveredTarget>;
  freshFields: ReadonlyArray<TraversedFieldValue>;
  duplicateFieldValueIds: ReadonlySet<string>;
  fallbackMatcher?: MatcherSpec;
}): FieldOperation[] {
  const context: OperationContext = {
    freshById: new Map(
      args.freshFields.map((fieldValue) => [
        fieldValueIdentity(fieldValue.ref),
        fieldValue,
      ]),
    ),
    freshFields: args.freshFields,
    duplicateFieldValueIds: args.duplicateFieldValueIds,
    operationsByFieldId: new Map(),
  };
  const selectedTargetIds = new Set<string>();

  for (const entry of args.entries) {
    const targetId = selectionTargetIdentity(entry.target);
    if (selectedTargetIds.has(targetId)) {
      throw new RootReplacementError(
        'stale',
        'The same selection appears more than once. Review the selection and try again.',
      );
    }
    selectedTargetIds.add(targetId);

    const freshField = unchangedFreshField(
      selectionTargetFieldValue(entry.target),
      context,
    );
    if (entry.target.kind === 'exact_match') {
      addExactMatchOperation(entry.target, freshField, context);
      continue;
    }

    const matcher = entry.matcher ?? args.fallbackMatcher;
    if (!matcher) {
      throw new RootReplacementError(
        'unsupported',
        'Enter the words to find before previewing this replacement.',
      );
    }
    for (const candidate of matcherCandidates(freshField, context)) {
      addMatcherOperation(candidate, matcher, context);
    }
  }

  return [...context.operationsByFieldId.values()];
}

/** Exact targets carry their matches; field-value targets are matched again. */
async function operationMatches(
  operation: FieldOperation,
  matchField: MatchReplacementField,
  signal?: AbortSignal,
): Promise<ExactMatchRef[]> {
  return operation.kind === 'matches'
    ? operation.matches
    : matchField(operation.fieldValue, operation.matcher, signal);
}

export async function prepareRootChanges(args: {
  root: TraversableRecord;
  entries: ReadonlyArray<DiscoveredTarget>;
  schema: SchemaIndex;
  siteId: string;
  environment: string;
  locales: ReadonlyArray<string>;
  /**
   * Compiled once from the Replace input (`compileReplacementTemplate`) and
   * expanded per match, exactly like the preview.
   */
  replacement: ReplacementTemplate;
  fallbackMatcher?: MatcherSpec;
  matchField: MatchReplacementField;
  signal?: AbortSignal;
  /**
   * true (default): the fresh root must still be at the version every entry
   * was found in. false: other edits to the record are fine; only the
   * selected field values must be unchanged (fingerprint and presence) and
   * still resolvable. Either way the changes are computed from `root` and
   * `currentVersion` is its version, for the update's optimistic lock.
   */
  strictRootVersion?: boolean;
}): Promise<PreparedRootChanges> {
  throwIfAborted(args.signal);
  const [firstEntry] = args.entries;
  if (!firstEntry) {
    throw new RootReplacementError(
      'unsupported',
      'Select at least one field before replacing.',
    );
  }

  const { rootRecordId, rootModelId, currentVersion } = validateRootIdentity({
    ...args,
    firstRef: selectionTargetFieldValue(firstEntry.target),
    strictRootVersion: args.strictRootVersion ?? true,
  });
  const traversed = traverseRecordWithDiagnostics({
    record: args.root,
    rootModelId,
    schema: args.schema,
    siteId: args.siteId,
    environment: args.environment,
    locales: args.locales,
  });
  const operations = selectedFieldOperations({
    entries: args.entries,
    freshFields: traversed.fieldValues,
    duplicateFieldValueIds: new Set(traversed.duplicateFieldValueIds),
    fallbackMatcher: args.fallbackMatcher,
  });
  const firstPresentation = firstEntry.presentation;
  const replacer = templateReplacer(args.replacement);
  const changedValues: ChangedFieldValue[] = [];
  const changes: ReplacementChange[] = [];
  let replacementCount = 0;
  let unchangedFieldCount = 0;

  if (operations.length === 0) {
    throw new RootReplacementError(
      'unsupported',
      'The selected field does not contain text that can be replaced.',
    );
  }

  for (const operation of operations) {
    throwIfAborted(args.signal);
    // biome-ignore lint/performance/noAwaitInLoops: fields are matched one at a time so each worker request gets the full timeout.
    const matches = await operationMatches(
      operation,
      args.matchField,
      args.signal,
    );
    throwIfAborted(args.signal);
    const replacement = replaceExactMatches(
      operation.fieldValue,
      matches,
      replacer,
    );

    if (!replacement.supported || !replacement.changed) {
      unchangedFieldCount += 1;
      continue;
    }
    if (!replacement.preview) {
      throw new RootReplacementError(
        'unsupported',
        'A replacement preview could not be prepared for this field.',
      );
    }

    const fieldValueId = fieldValueIdentity(operation.fieldValue.ref);
    changedValues.push({
      fieldValue: operation.fieldValue,
      value: replacement.value,
    });
    replacementCount += replacement.replacementCount;
    changes.push({
      id: `${rootRecordId}:${fieldValueId}`,
      rootRecordId,
      recordLabel: firstPresentation.record.title,
      modelName: firstPresentation.model.name,
      fieldLabel: operation.fieldValue.field.label,
      locale: displayLocale(operation.fieldValue),
      replacementCount: replacement.replacementCount,
      preview: replacement.preview,
    });
  }

  return {
    rootRecordId,
    rootModelId,
    currentVersion,
    recordLabel: firstPresentation.record.title,
    modelName: firstPresentation.model.name,
    changedValues,
    changes,
    replacementCount,
    unchangedFieldCount,
  };
}
