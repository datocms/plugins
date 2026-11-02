/**
 * startBlockedReason.ts
 * ---------------------
 * The one reason a disabled "Translate" button gives on the bulk page and the
 * records-action picker modal (`disabled={{ reason }}`). Returns the first
 * matching reason, in priority order, as a full sentence, and `null` only
 * when the run can start.
 */
import type {
  TranslatableField,
  TranslationReadiness,
} from '../../utils/translation/BulkTranslationHelpers';

const NO_MODEL_REASON = 'Pick at least one model first.';

type ModelRef = { value: string; label: string };

export function getStartBlockedReason(a: {
  providerConfigured: boolean;
  readiness: TranslationReadiness;
  models: ReadonlyArray<ModelRef>;
  pendingModelIds: ReadonlySet<string>;
  failedModelIds: ReadonlySet<string>;
  fieldsByModel: Record<string, TranslatableField[] | undefined>;
  /** Whether an empty model selection is a user-facing reason (page only). */
  requireModels: boolean;
}): string | null {
  const { readiness, models } = a;

  if (!a.providerConfigured) {
    return 'Set up an AI vendor in the plugin settings first.';
  }
  if (readiness.missingSourceLocale) {
    return 'Pick the locale to translate from first.';
  }
  if (readiness.missingTargetLocales) {
    return 'Pick at least one locale to translate into.';
  }
  if (a.requireModels && readiness.missingModels) return NO_MODEL_REASON;

  const pending = models.find((m) => a.pendingModelIds.has(m.value));
  if (pending) return `Wait for the fields of ${pending.label} to load.`;

  const failed = models.find((m) => a.failedModelIds.has(m.value));
  if (failed) {
    return `The fields of ${failed.label} couldn't be loaded. Try loading them again.`;
  }

  const deadEnd = models.find((m) => a.fieldsByModel[m.value]?.length === 0);
  if (deadEnd) {
    return `${deadEnd.label} has no fields the plugin can translate.`;
  }

  const missingFieldsId = readiness.modelsMissingFields[0];
  if (missingFieldsId !== undefined) {
    const label =
      models.find((m) => m.value === missingFieldsId)?.label ?? missingFieldsId;
    return `Pick at least one field of ${label} first.`;
  }

  if (!readiness.isReady) {
    // Only reachable with `requireModels: false` and no models, which the
    // picker never receives (the dropdown handler bails out first).
    return NO_MODEL_REASON;
  }

  return null;
}
