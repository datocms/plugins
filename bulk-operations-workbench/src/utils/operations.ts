import {
  ApiError,
  fromNormalizedFieldValueEntries,
  isLocalized,
  toNormalizedFieldValueEntries,
  type Client,
} from '@datocms/cma-client-browser';
import type {
  CandidateRecord,
  ExecutionProgress,
  ExecutionRow,
  FieldSummary,
  OperationPlan,
  PreparedChange,
  PreviewRow,
} from '../types';
import { isTextLikeField } from './schema';

type NormalizedEntry = {
  locale: string | undefined;
  value: unknown;
};

type PreviewBuildResult = {
  rows: PreviewRow[];
  preparedChanges: PreparedChange[];
};

type LocalePreviewResult = {
  preview: PreviewRow;
  nextValue?: string | null;
  localeKey: string | null;
};

function asStringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  return value;
}

function displayString(value: unknown): string | null {
  const stringValue = asStringOrNull(value);
  if (stringValue === null) {
    return null;
  }

  return stringValue === '' ? null : stringValue;
}

function getFieldValue(snapshot: Record<string, unknown>, field: FieldSummary): unknown {
  return snapshot[field.api_key];
}

function getNormalizedEntries(
  snapshot: Record<string, unknown>,
  field: FieldSummary,
): NormalizedEntry[] {
  return toNormalizedFieldValueEntries(getFieldValue(snapshot, field), field) as NormalizedEntry[];
}

function readEntryValue(
  entries: NormalizedEntry[],
  field: FieldSummary,
  locale: string | null,
): unknown {
  const localized = isLocalized(field);
  if (!localized) {
    return entries.find((entry) => entry.locale === undefined)?.value;
  }

  if (!locale) {
    return undefined;
  }

  return entries.find((entry) => entry.locale === locale)?.value;
}

function replaceEntryValue(
  entries: NormalizedEntry[],
  field: FieldSummary,
  locale: string | null,
  value: unknown,
): NormalizedEntry[] {
  const localized = isLocalized(field);

  if (!localized) {
    return [{ locale: undefined, value }];
  }

  if (!locale) {
    throw new Error(`Locale is required for localized field ${field.api_key}`);
  }

  const preservedEntries = entries.filter((entry) => entry.locale !== locale);
  return [...preservedEntries, { locale, value }];
}

function resolveModelRule(
  plan: OperationPlan,
  modelId: string,
): { targetFieldId: string; sourceFieldId?: string; onlyIfEmpty?: boolean } | null {
  switch (plan.type) {
    case 'copyField': {
      const rule = plan.perModel.find((entry) => entry.modelId === modelId);
      if (!rule) {
        return null;
      }
      return {
        targetFieldId: rule.targetFieldId,
        sourceFieldId: rule.sourceFieldId,
        onlyIfEmpty: plan.onlyIfEmpty,
      };
    }
    case 'setFixedValue': {
      const rule = plan.perModel.find((entry) => entry.modelId === modelId);
      if (!rule) {
        return null;
      }
      return {
        targetFieldId: rule.targetFieldId,
        onlyIfEmpty: plan.onlyIfEmpty,
      };
    }
    default: {
      const rule = plan.perModel.find((entry) => entry.modelId === modelId);
      if (!rule) {
        return null;
      }
      return { targetFieldId: rule.targetFieldId };
    }
  }
}

function buildInvalidRow(
  candidate: CandidateRecord,
  locale: string | null,
  reason: string,
  targetFieldApiKey = '—',
  sourceFieldApiKey?: string,
): PreviewRow {
  return {
    recordId: candidate.id,
    modelId: candidate.modelId,
    modelName: candidate.modelName,
    recordTitle: candidate.title,
    targetFieldApiKey,
    sourceFieldApiKey,
    locale,
    beforeValue: null,
    afterValue: null,
    outcome: 'invalid',
    reason,
  };
}

function buildLocalePreview(
  candidate: CandidateRecord,
  plan: OperationPlan,
  targetField: FieldSummary,
  targetEntries: NormalizedEntry[],
  sourceField: FieldSummary | undefined,
  sourceEntries: NormalizedEntry[] | undefined,
  locale: string | null,
  onlyIfEmpty: boolean,
): LocalePreviewResult {
  const currentTargetValue = readEntryValue(targetEntries, targetField, locale);
  const beforeValue = displayString(currentTargetValue);

  let nextValue: string | null = beforeValue;
  let outcome: PreviewRow['outcome'] = 'change';
  let reason: string | undefined;

  switch (plan.type) {
    case 'findReplace': {
      if (plan.find === '') {
        outcome = 'invalid';
        reason = 'Find value cannot be empty.';
        break;
      }
      const sourceText = beforeValue ?? '';
      const replaced = sourceText.split(plan.find).join(plan.replace);
      nextValue = replaced === '' ? null : replaced;
      if (sourceText === replaced) {
        outcome = 'no_change';
        reason = 'No match found in target field.';
      }
      break;
    }
    case 'prepend': {
      const sourceText = beforeValue ?? '';
      const combined = `${plan.value}${sourceText}`;
      nextValue = combined === '' ? null : combined;
      if (combined === sourceText) {
        outcome = 'no_change';
        reason = 'Value already matches preview result.';
      }
      break;
    }
    case 'append': {
      const sourceText = beforeValue ?? '';
      const combined = `${sourceText}${plan.value}`;
      nextValue = combined === '' ? null : combined;
      if (combined === sourceText) {
        outcome = 'no_change';
        reason = 'Value already matches preview result.';
      }
      break;
    }
    case 'setFixedValue': {
      if (onlyIfEmpty && beforeValue !== null) {
        outcome = 'skip';
        reason = 'Target field already has a value.';
        break;
      }
      nextValue = plan.value === '' ? null : plan.value;
      if (nextValue === beforeValue) {
        outcome = 'no_change';
        reason = 'Target field already has the requested value.';
      }
      break;
    }
    case 'clearValue': {
      nextValue = null;
      if (beforeValue === null) {
        outcome = 'no_change';
        reason = 'Target field is already empty.';
      }
      break;
    }
    case 'copyField': {
      if (!sourceField || !sourceEntries) {
        outcome = 'invalid';
        reason = 'Source field not found.';
        break;
      }

      if (onlyIfEmpty && beforeValue !== null) {
        outcome = 'skip';
        reason = 'Target field already has a value.';
        break;
      }

      const sourceValue = readEntryValue(sourceEntries, sourceField, locale);
      nextValue = displayString(sourceValue);

      if (nextValue === beforeValue) {
        outcome = 'no_change';
        reason = 'Source and target values are already identical.';
      }
      break;
    }
  }

  return {
    preview: {
      recordId: candidate.id,
      modelId: candidate.modelId,
      modelName: candidate.modelName,
      recordTitle: candidate.title,
      targetFieldApiKey: targetField.api_key,
      sourceFieldApiKey: sourceField?.api_key,
      locale,
      beforeValue,
      afterValue: nextValue,
      outcome,
      reason,
    },
    ...(outcome === 'change' ? { nextValue, localeKey: locale } : { localeKey: locale }),
  };
}

function buildPreviewChangesForCandidate(args: {
  candidate: CandidateRecord;
  plan: OperationPlan;
  selectedLocales: string[];
  allLocales: string[];
  fieldsByModelId: Record<string, FieldSummary[]>;
}): { rows: PreviewRow[]; preparedChange?: PreparedChange } {
  const { candidate, plan, selectedLocales, allLocales, fieldsByModelId } = args;
  const selectedLocale = selectedLocales[0] ?? null;
  const fields = fieldsByModelId[candidate.modelId] ?? [];
  const fieldMap = new Map(fields.map((field) => [field.id, field]));
  const rule = resolveModelRule(plan, candidate.modelId);

  if (!rule) {
    return {
      rows: [buildInvalidRow(candidate, selectedLocale, 'Missing field mapping for model.')],
    };
  }

  const targetField = fieldMap.get(rule.targetFieldId);
  if (!targetField) {
    return {
      rows: [buildInvalidRow(candidate, selectedLocale, 'Target field not found.')],
    };
  }

  if (!isTextLikeField(targetField)) {
    return {
      rows: [
        buildInvalidRow(
          candidate,
          selectedLocale,
          'Target field is not supported in v1.',
          targetField.api_key,
        ),
      ],
    };
  }

  let sourceField: FieldSummary | undefined;
  if (plan.type === 'copyField') {
    sourceField = rule.sourceFieldId ? fieldMap.get(rule.sourceFieldId) : undefined;

    if (!sourceField) {
      return {
        rows: [
          buildInvalidRow(
            candidate,
            selectedLocale,
            'Source field not found.',
            targetField.api_key,
          ),
        ],
      };
    }

    if (!isTextLikeField(sourceField)) {
      return {
        rows: [
          buildInvalidRow(
            candidate,
            selectedLocale,
            'Source field is not supported in v1.',
            targetField.api_key,
            sourceField.api_key,
          ),
        ],
      };
    }

    if (isLocalized(targetField) !== isLocalized(sourceField)) {
      return {
        rows: [
          buildInvalidRow(
            candidate,
            selectedLocale,
            'Source and target localization must match.',
            targetField.api_key,
            sourceField.api_key,
          ),
        ],
      };
    }
  }

  const targetEntries = getNormalizedEntries(candidate.snapshot, targetField);
  const sourceEntries = sourceField
    ? getNormalizedEntries(candidate.snapshot, sourceField)
    : undefined;

  const localesToProcess = isLocalized(targetField)
    ? selectedLocales.length > 0
      ? selectedLocales
      : allLocales
    : [null];

  if (isLocalized(targetField) && localesToProcess.length === 0) {
    return {
      rows: [
        buildInvalidRow(
          candidate,
          null,
          'No site locales are available for this localized field.',
          targetField.api_key,
          sourceField?.api_key,
        ),
      ],
    };
  }

  const rows: PreviewRow[] = [];
  const changedLocales = new Map<string | null, string | null>();

  for (const locale of localesToProcess) {
    const result = buildLocalePreview(
      candidate,
      plan,
      targetField,
      targetEntries,
      sourceField,
      sourceEntries,
      locale,
      Boolean(rule.onlyIfEmpty),
    );

    rows.push(result.preview);
    if (result.preview.outcome === 'change') {
      changedLocales.set(result.localeKey, result.nextValue ?? null);
    }
  }

  if (changedLocales.size === 0) {
    return { rows };
  }

  if (!candidate.currentVersion) {
    return {
      rows: rows.map((row) =>
        row.outcome === 'change'
          ? {
              ...row,
              outcome: 'invalid',
              reason: 'Current record version is missing. Refresh the preview and try again.',
            }
          : row,
      ),
    };
  }

  let nextEntries = [...targetEntries];
  for (const [locale, nextValue] of changedLocales) {
    nextEntries = replaceEntryValue(nextEntries, targetField, locale, nextValue);
  }

  return {
    rows,
    preparedChange: {
      preview: rows.find((row) => row.outcome === 'change') ?? rows[0],
      recordStatus: candidate.status,
      currentVersion: candidate.currentVersion,
      targetFieldApiKey: targetField.api_key,
      payload: {
        [targetField.api_key]: fromNormalizedFieldValueEntries(nextEntries, targetField),
        meta: {
          current_version: candidate.currentVersion,
        },
      },
    },
  };
}

export function buildPreviewChanges(args: {
  candidates: CandidateRecord[];
  plan: OperationPlan;
  locales: string[];
  allLocales: string[];
  fieldsByModelId: Record<string, FieldSummary[]>;
}): PreviewBuildResult {
  const rows: PreviewRow[] = [];
  const preparedChanges: PreparedChange[] = [];

  for (const candidate of args.candidates) {
    if (!candidate.selected) {
      continue;
    }

    const result = buildPreviewChangesForCandidate({
      candidate,
      plan: args.plan,
      selectedLocales: args.locales,
      allLocales: args.allLocales,
      fieldsByModelId: args.fieldsByModelId,
    });

    rows.push(...result.rows);
    if (result.preparedChange) {
      preparedChanges.push(result.preparedChange);
    }
  }

  return { rows, preparedChanges };
}

function messageFromError(error: unknown): string {
  if (error instanceof ApiError) {
    const apiError = error as ApiError;
    const first = apiError.errors[0];
    if (first) {
      return `${first.attributes.code}: ${JSON.stringify(first.attributes.details)}`;
    }
    return `${apiError.response.status} ${apiError.response.statusText}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Unknown error';
}

async function runConcurrent<T>(
  inputs: T[],
  limit: number,
  worker: (input: T) => Promise<void>,
): Promise<void> {
  const queue = [...inputs];
  const safeLimit = Math.max(1, limit);
  const runners = Array.from({ length: Math.min(safeLimit, queue.length) }, async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) {
        return;
      }
      await worker(next);
    }
  });

  await Promise.all(runners);
}

export async function executePreparedChanges(args: {
  client: Client;
  changes: PreparedChange[];
  batchSize: number;
  concurrency: number;
  onProgress?: (progress: ExecutionProgress) => void;
}): Promise<ExecutionRow[]> {
  const { client, changes, batchSize, concurrency, onProgress } = args;
  const results: ExecutionRow[] = [];
  const progress: ExecutionProgress = {
    total: changes.length,
    completed: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    currentLabel: changes.length > 0 ? 'Starting run…' : 'Nothing to update.',
  };

  onProgress?.(progress);

  for (let index = 0; index < changes.length; index += batchSize) {
    const batch = changes.slice(index, index + batchSize);

    await runConcurrent(batch, concurrency, async (change) => {
      progress.currentLabel = `${change.preview.modelName} · ${change.preview.recordTitle}`;
      onProgress?.({ ...progress });

      try {
        await client.items.update(change.preview.recordId, change.payload);
        results.push({
          recordId: change.preview.recordId,
          modelId: change.preview.modelId,
          modelName: change.preview.modelName,
          recordTitle: change.preview.recordTitle,
          status: 'success',
          message: `${change.targetFieldApiKey} updated`,
        });
        progress.success += 1;
      } catch (error) {
        results.push({
          recordId: change.preview.recordId,
          modelId: change.preview.modelId,
          modelName: change.preview.modelName,
          recordTitle: change.preview.recordTitle,
          status: 'failed',
          message: messageFromError(error),
        });
        progress.failed += 1;
      } finally {
        progress.completed += 1;
        onProgress?.({ ...progress });
      }
    });
  }

  progress.currentLabel = 'Run finished.';
  onProgress?.({ ...progress });

  return results.sort((a, b) => a.recordId.localeCompare(b.recordId));
}
