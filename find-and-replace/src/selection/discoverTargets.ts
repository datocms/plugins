import type { Client } from '@datocms/cma-client-browser';
import {
  createDiscoveryController,
  type DiscoveryController,
  recordCurrentVersion,
  recordStatus,
  recordUpdatedAt,
} from './discovery';
import { selectionTargetIdentity } from './identity';
import {
  fieldPathSegments,
  modelRecordTitle,
  seoSubfieldLabel,
} from './labels';
import {
  MatcherWorkerSession,
  matchesForTraversedFields,
  matchesForTraversedFieldsInWorker,
} from './matcher';
import type { DiscoveryModel, RawNestedItem } from './query';
import { discoveryModelsOf } from './schemaIndex';
import { traverseRecord } from './traversal';
import type {
  DiscoverySpec,
  ExactMatchRef,
  MatchContext,
  MatcherSpec,
  SchemaIndex,
  SelectionTarget,
  TraversedFieldValue,
  ValuePath,
} from './types';

export type TargetPresentation = {
  model: {
    id: string;
    name: string;
    apiKey: string;
  };
  record: {
    id: string;
    /** presentation_title_field → title_field → title-like attributes; null when none has a value. */
    title: string | null;
    status: 'draft' | 'updated' | 'published';
    currentVersion: string | null;
    updatedAt: string | null;
  };
  field: {
    id: string;
    label: string;
    apiKey: string;
    type: string;
    locale: string | null;
    ownerRecordId: string;
    ownerModelId: string;
    path: ValuePath;
    /**
     * Human path, schema labels only, outermost first (see
     * `fieldPathSegments`). Matches in an SEO field end with "Title" or
     * "Description".
     */
    pathSegments: ReadonlyArray<string>;
    isContainer: boolean;
  };
  valuePreview: string;
  matchCount?: number;
  excerpt?: MatchContext;
};

export type DiscoveredTarget = {
  target: SelectionTarget;
  /**
   * Shared by every target of the same record (model, record) and of the same
   * field value (field): never mutate it.
   */
  presentation: TargetPresentation;
  /** Matcher used when this target was discovered. Kept with the basket entry. */
  matcher?: MatcherSpec;
};

/** Matches one field value. Test seam: `matchesForTraversedField` inline. */
export type MatchTraversedField = (
  fieldValue: TraversedFieldValue,
  matcher: MatcherSpec,
  signal?: AbortSignal,
) => Promise<ExactMatchRef[]>;

/**
 * Matches many field values in one go (see
 * `matchesForTraversedFieldsInWorker`). Returns one array per field value, in
 * input order.
 */
export type MatchTraversedFields = (
  fieldValues: ReadonlyArray<TraversedFieldValue>,
  matcher: MatcherSpec,
  signal?: AbortSignal,
) => Promise<ExactMatchRef[][]>;

type DiscoveryContextOptions = {
  schema: SchemaIndex;
  siteId: string;
  environment: string;
  spec: DiscoverySpec;
  signal?: AbortSignal;
  /** Per-field matching. Used only when `matchFields` isn't given. */
  matchField?: MatchTraversedField;
  /**
   * Batched matching: one call per record (or per group of records).
   * Production scans pass the worker-backed implementation. Defaults to
   * inline matching on the calling thread.
   */
  matchFields?: MatchTraversedFields;
};

export type DiscoverTargetsInRecordOptions = DiscoveryContextOptions & {
  record: RawNestedItem;
  rootModelId: string;
};

export type DiscoverTargetsInRecordsOptions = DiscoveryContextOptions & {
  records: ReadonlyArray<{ record: RawNestedItem; rootModelId: string }>;
};

type PreparedRecord = {
  record: RawNestedItem;
  rootModelId: string;
  fieldValues: TraversedFieldValue[];
};

function requiredMatcher(spec: DiscoverySpec): MatcherSpec | null {
  const required =
    spec.workflow === 'text' || spec.granularity === 'exact_match';
  if (!required) {
    return null;
  }
  if (!spec.matcher) {
    throw new Error(
      'This discovery mode requires text or a regular expression.',
    );
  }
  return spec.matcher;
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Discovery was cancelled.', 'AbortError');
  }
}

export function fieldDisplayLocale(
  locale: string | null,
  ancestry: ReadonlyArray<{ locale: string | null }>,
): string | null {
  if (locale) return locale;

  for (let index = ancestry.length - 1; index >= 0; index -= 1) {
    const inheritedLocale = ancestry[index]?.locale;
    if (inheritedLocale) return inheritedLocale;
  }

  return null;
}

function previewValue(value: unknown, present: boolean): string {
  if (!present) return 'Missing value';
  if (value === null || value === undefined || value === '') {
    return 'Empty value';
  }
  if (typeof value === 'string') {
    return value.length > 120 ? `${value.slice(0, 117)}…` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `${value.length} ${value.length === 1 ? 'item' : 'items'}`;
  }
  return 'Structured value';
}

function belongsToWorkflow(
  fieldValue: TraversedFieldValue,
  spec: DiscoverySpec,
): boolean {
  if (
    spec.workflow === 'text' &&
    spec.fieldTypes?.length &&
    !spec.fieldTypes.some(
      (fieldType) => fieldType === fieldValue.field.fieldType,
    )
  ) {
    return false;
  }

  if (spec.workflow === 'field_api_key') {
    return Boolean(spec.apiKey) && fieldValue.field.apiKey === spec.apiKey;
  }
  return true;
}

function prepareRecord(
  record: RawNestedItem,
  rootModelId: string,
  options: DiscoveryContextOptions,
): PreparedRecord {
  const { spec } = options;
  if (
    spec.workflow === 'browse' &&
    spec.browse?.recordId &&
    record.id !== spec.browse.recordId
  ) {
    return { record, rootModelId, fieldValues: [] };
  }

  const fieldValues = traverseRecord({
    record,
    rootModelId,
    schema: options.schema,
    siteId: options.siteId,
    environment: options.environment,
    locales: spec.locales,
  }).filter((fieldValue) => belongsToWorkflow(fieldValue, spec));
  return { record, rootModelId, fieldValues };
}

function canMatch(fieldValue: TraversedFieldValue): boolean {
  return fieldValue.ref.present && fieldValue.field.exactMatchCompatible;
}

function batchedMatcher(
  options: DiscoveryContextOptions,
): MatchTraversedFields {
  if (options.matchFields) return options.matchFields;
  const { matchField } = options;
  if (matchField) {
    return (fieldValues, matcher, signal) =>
      Promise.all(
        fieldValues.map((fieldValue) =>
          matchField(fieldValue, matcher, signal),
        ),
      );
  }
  return async (fieldValues, matcher) =>
    matchesForTraversedFields(fieldValues, matcher);
}

async function matchPreparedRecords(
  prepared: ReadonlyArray<PreparedRecord>,
  matcher: MatcherSpec,
  options: DiscoveryContextOptions,
): Promise<Map<TraversedFieldValue, ExactMatchRef[]>> {
  const matchable = prepared.flatMap(({ fieldValues }) =>
    fieldValues.filter(canMatch),
  );
  const matchesByFieldValue = new Map<TraversedFieldValue, ExactMatchRef[]>();
  if (matchable.length === 0) return matchesByFieldValue;

  const results = await batchedMatcher(options)(
    matchable,
    matcher,
    options.signal,
  );
  throwIfCancelled(options.signal);
  for (const [index, fieldValue] of matchable.entries()) {
    matchesByFieldValue.set(fieldValue, results[index] ?? []);
  }
  return matchesByFieldValue;
}

/**
 * Builds presentations, sharing one object per record and per field value.
 * The record part (title included) is computed once, on the first target.
 */
class RecordPresenter {
  private cachedBase: Pick<TargetPresentation, 'model' | 'record'> | null =
    null;

  constructor(
    private readonly prepared: PreparedRecord,
    private readonly schema: SchemaIndex,
    private readonly locales: ReadonlyArray<string>,
  ) {}

  private get base(): Pick<TargetPresentation, 'model' | 'record'> {
    if (this.cachedBase) return this.cachedBase;
    const { record, rootModelId } = this.prepared;
    const model = this.schema.modelsById.get(rootModelId);
    this.cachedBase = {
      model: {
        id: rootModelId,
        name: model?.name ?? rootModelId,
        apiKey: model?.apiKey ?? rootModelId,
      },
      record: {
        id: record.id,
        title: modelRecordTitle(this.schema, rootModelId, record, this.locales),
        status: recordStatus(record),
        currentVersion: recordCurrentVersion(record),
        updatedAt: recordUpdatedAt(record),
      },
    };
    return this.cachedBase;
  }

  /** One presenter per field value; SEO matches get a per-subfield path. */
  forFieldValue(
    fieldValue: TraversedFieldValue,
  ): (
    extras: Pick<TargetPresentation, 'matchCount' | 'excerpt'>,
    match?: ExactMatchRef,
  ) => TargetPresentation {
    const segments = fieldPathSegments({
      fieldValue: fieldValue.ref,
      schema: this.schema,
      record: this.prepared.record,
    });
    const valuePreview = previewValue(fieldValue.value, fieldValue.ref.present);
    const fields = new Map<string, TargetPresentation['field']>();
    const fieldFor = (subfield: string | null): TargetPresentation['field'] => {
      const key = subfield ?? '';
      const cached = fields.get(key);
      if (cached) return cached;
      const field = this.fieldPresentation(
        fieldValue,
        subfield ? [...segments, subfield] : segments,
      );
      fields.set(key, field);
      return field;
    };

    return (extras, match) => ({
      ...this.base,
      field: fieldFor(
        match && fieldValue.field.fieldType === 'seo'
          ? seoSubfieldLabel(match.fragments)
          : null,
      ),
      valuePreview,
      ...extras,
    });
  }

  private fieldPresentation(
    fieldValue: TraversedFieldValue,
    pathSegments: ReadonlyArray<string>,
  ): TargetPresentation['field'] {
    return {
      id: fieldValue.field.id,
      label: fieldValue.field.label,
      apiKey: fieldValue.field.apiKey,
      type: fieldValue.field.fieldType,
      locale: fieldDisplayLocale(
        fieldValue.ref.locale,
        fieldValue.ref.blockAncestry,
      ),
      ownerRecordId: fieldValue.owner.id,
      ownerModelId: fieldValue.owner.modelId,
      path: fieldValue.ref.valuePath,
      pathSegments,
      isContainer: fieldValue.isContainer,
    };
  }
}

function targetsForField(
  fieldValue: TraversedFieldValue,
  matches: ReadonlyArray<ExactMatchRef> | null,
  presenter: RecordPresenter,
  spec: DiscoverySpec,
): DiscoveredTarget[] {
  const withMatcher = spec.matcher ? { matcher: spec.matcher } : {};

  if (matches === null) {
    return [
      {
        target: fieldValue.ref,
        ...withMatcher,
        presentation: presenter.forFieldValue(fieldValue)({}),
      },
    ];
  }
  if (matches.length === 0) return [];

  const present = presenter.forFieldValue(fieldValue);
  if (spec.granularity === 'field_value') {
    return [
      {
        target: fieldValue.ref,
        ...withMatcher,
        presentation: present({
          matchCount: matches.length,
          excerpt: matches[0]?.context,
        }),
      },
    ];
  }

  return matches.map((match) => ({
    target: match,
    ...withMatcher,
    presentation: present({ matchCount: 1, excerpt: match.context }, match),
  }));
}

/**
 * Turns hydrated roots into selectable targets, one array per record, in
 * input order. Every field value of every record is matched in one batched
 * call. Traversal and matching are deliberately local so server filters can
 * never hide nested values.
 */
export async function discoverTargetsInRecords(
  options: DiscoverTargetsInRecordsOptions,
): Promise<DiscoveredTarget[][]> {
  throwIfCancelled(options.signal);
  const { spec } = options;
  const matcher = requiredMatcher(spec);
  const prepared = options.records.map(({ record, rootModelId }) =>
    prepareRecord(record, rootModelId, options),
  );
  const matchesByFieldValue = matcher
    ? await matchPreparedRecords(prepared, matcher, options)
    : null;

  return prepared.map((entry) => {
    if (entry.fieldValues.length === 0) return [];
    const presenter = new RecordPresenter(entry, options.schema, spec.locales);
    return entry.fieldValues.flatMap((fieldValue) =>
      targetsForField(
        fieldValue,
        matchesByFieldValue
          ? (matchesByFieldValue.get(fieldValue) ?? [])
          : null,
        presenter,
        spec,
      ),
    );
  });
}

/** Turns one hydrated root into selectable targets (one batched match call). */
export async function discoverTargetsInRecord({
  record,
  rootModelId,
  ...options
}: DiscoverTargetsInRecordOptions): Promise<DiscoveredTarget[]> {
  const [targets] = await discoverTargetsInRecords({
    ...options,
    records: [{ record, rootModelId }],
  });
  return targets ?? [];
}

export type CreateSelectionDiscoveryControllerOptions = {
  client: Client;
  schema: SchemaIndex;
  siteId: string;
  environment: string;
  workerSessionFactory?: () => MatcherWorkerSession;
  /** Test seam: match each field value with this instead of a worker. */
  matchField?: MatchTraversedField;
};

/**
 * Ready-to-use bridge from the browser CMA client to selection targets. One
 * matcher worker per run, terminated when the run settles or is cancelled;
 * models are scanned in the order of the spec's `rootModelIds`.
 */
export function createSelectionDiscoveryController({
  client,
  schema,
  siteId,
  environment,
  workerSessionFactory = () => new MatcherWorkerSession(),
  matchField,
}: CreateSelectionDiscoveryControllerOptions): DiscoveryController<DiscoveredTarget> {
  const workersByRunId = new Map<string, MatcherWorkerSession>();
  const terminateRunWorker = (runId: string): void => {
    workersByRunId.get(runId)?.terminate();
    workersByRunId.delete(runId);
  };
  const workerMatchFields =
    (runId: string): MatchTraversedFields =>
    (fieldValues, matcher, signal) => {
      let worker = workersByRunId.get(runId);
      if (!worker) {
        worker = workerSessionFactory();
        workersByRunId.set(runId, worker);
      }
      return matchesForTraversedFieldsInWorker(
        fieldValues,
        matcher,
        worker,
        signal,
      );
    };
  const models: DiscoveryModel[] = discoveryModelsOf(schema);

  return createDiscoveryController<DiscoveredTarget>({
    client,
    models,
    targetKey: (result) => selectionTargetIdentity(result.target),
    // One matcher call per page of records (a network page, or a replayed
    // batch of cached records).
    discoverRecords: (records, context) =>
      discoverTargetsInRecords({
        records: records.map((record) => ({
          record,
          rootModelId: context.model.id,
        })),
        schema,
        siteId,
        environment,
        spec: context.spec,
        signal: context.signal,
        ...(matchField
          ? { matchField }
          : { matchFields: workerMatchFields(context.runId) }),
      }),
    onCancel: terminateRunWorker,
    onRunFinished: terminateRunWorker,
  });
}
