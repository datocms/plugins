/**
 * startBlockedReason.ts
 * ---------------------
 * The one reason shown in the tooltip of a disabled "Translate" action on the
 * bulk page and the records-action picker modal. Returns the first matching
 * reason, in priority order, and `null` only when the run can start.
 */
import type {
  TranslatableField,
  TranslationReadiness,
} from '../../utils/translation/BulkTranslationHelpers';

const PREFIX = 'You cannot translate records';

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

  if (!a.providerConfigured) return `${PREFIX} as no AI vendor is set up`;
  if (readiness.missingSourceLocale) {
    return `${PREFIX} as no source locale is selected`;
  }
  if (readiness.missingTargetLocales) {
    return `${PREFIX} as no target locale is selected`;
  }
  if (a.requireModels && readiness.missingModels) {
    return `${PREFIX} as no model is selected`;
  }

  const pending = models.find((m) => a.pendingModelIds.has(m.value));
  if (pending) {
    return `${PREFIX} while the fields of ${pending.label} are loading`;
  }

  const failed = models.find((m) => a.failedModelIds.has(m.value));
  if (failed) {
    return `${PREFIX} as the fields of ${failed.label} couldn't be loaded`;
  }

  const deadEnd = models.find((m) => a.fieldsByModel[m.value]?.length === 0);
  if (deadEnd) {
    return `${PREFIX} as ${deadEnd.label} has no translatable fields`;
  }

  const missingFieldsId = readiness.modelsMissingFields[0];
  if (missingFieldsId !== undefined) {
    const label =
      models.find((m) => m.value === missingFieldsId)?.label ?? missingFieldsId;
    return `${PREFIX} as no field of ${label} is selected`;
  }

  if (!readiness.isReady) {
    // Only reachable with `requireModels: false` and no models, which the
    // picker never receives (the dropdown handler bails out first).
    return `${PREFIX} as no model is selected`;
  }

  return null;
}
