import type { ApiTypes, Client } from '@datocms/cma-client-browser';
import type {
  CandidateRecord,
  CandidateStatus,
  ModelSearchPlan,
  ModelSummary,
  SearchCounts,
  SearchProgress,
} from '../types';

type ItemRecord = ApiTypes.Item & Record<string, unknown>;

type QueryShape = {
  filter: {
    type: string;
    fields?: Record<string, unknown>;
    query?: string;
  };
  version: 'current';
  nested: true;
  locale?: string;
};

type QueryVariant = {
  locale: string | null;
  publicationStatus: Exclude<ModelSearchPlan['publicationStatuses'][number], 'all'> | null;
};

type QueryOverride = {
  extraFieldFilter?: Record<string, unknown>;
  fullTextQuery?: string;
};

function buildOperatorFilter(condition: ModelSearchPlan['fieldConditions'][number]) {
  switch (condition.operator) {
    case 'eq':
      return { eq: condition.value ?? '' };
    case 'neq':
      return { neq: condition.value ?? '' };
    case 'matches':
      return {
        matches: {
          pattern: condition.value ?? '',
          case_sensitive: false,
        },
      };
    case 'exists':
      return { exists: true };
    case 'not_exists':
      return { not_exists: true };
  }
}

function expandQueryVariants(plan: ModelSearchPlan): QueryVariant[] {
  const locales = plan.locales.length > 0 ? plan.locales : [null];
  const publicationStatuses =
    plan.publicationStatuses.length > 0 ? plan.publicationStatuses : [null];
  const variants: QueryVariant[] = [];

  for (const locale of locales) {
    for (const publicationStatus of publicationStatuses) {
      variants.push({
        locale,
        publicationStatus:
          publicationStatus && publicationStatus !== 'all' ? publicationStatus : null,
      });
    }
  }

  return variants;
}

function buildModelQuery(
  model: ModelSummary,
  plan: ModelSearchPlan,
  variant: QueryVariant,
  override: QueryOverride = {},
): QueryShape {
  const fieldEntries: Array<[string, unknown]> = plan.fieldConditions.map((condition) => [
    condition.apiKey,
    buildOperatorFilter(condition),
  ]);

  if (variant.publicationStatus) {
    fieldEntries.push(['_status', { eq: variant.publicationStatus }]);
  }

  if (override.extraFieldFilter) {
    for (const [key, value] of Object.entries(override.extraFieldFilter)) {
      fieldEntries.push([key, value]);
    }
  }

  const filter: QueryShape['filter'] = {
    type: model.apiKey,
  };

  if (fieldEntries.length > 0) {
    filter.fields = Object.fromEntries(fieldEntries);
  }

  if (override.fullTextQuery && override.fullTextQuery.trim() !== '') {
    filter.query = override.fullTextQuery.trim();
  }

  return {
    filter,
    version: 'current',
    nested: true,
    ...(variant.locale ? { locale: variant.locale } : {}),
  };
}

function extractMeta(record: Record<string, unknown>): Record<string, unknown> {
  const rawMeta = record.meta;
  if (rawMeta && typeof rawMeta === 'object') {
    return rawMeta as Record<string, unknown>;
  }
  return {};
}

function readCandidateStatus(record: Record<string, unknown>): CandidateStatus {
  const meta = extractMeta(record);
  const status = meta.status;

  if (status === 'updated' || status === 'published') {
    return status;
  }

  return 'draft';
}

function readCurrentVersion(record: Record<string, unknown>): string | null {
  const meta = extractMeta(record);
  return typeof meta.current_version === 'string' ? meta.current_version : null;
}

function readUpdatedAt(record: Record<string, unknown>): string | null {
  const meta = extractMeta(record);
  if (typeof meta.updated_at === 'string') {
    return meta.updated_at;
  }

  return typeof record.updated_at === 'string' ? record.updated_at : null;
}

function valueToString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const resolved = valueToString(entry);
      if (resolved) {
        return resolved;
      }
    }
  }

  if (value && typeof value === 'object') {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      const resolved = valueToString(entry);
      if (resolved) {
        return resolved;
      }
    }
  }

  return null;
}

function resolveRecordTitle(
  record: Record<string, unknown>,
  preferredLocales: string[],
): string {
  const preferredKeys = ['title', 'name', 'slug', 'heading', 'label'];

  for (const key of preferredKeys) {
    if (!(key in record)) {
      continue;
    }

    const rawValue = record[key];
    if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
      const localizedValues = rawValue as Record<string, unknown>;
      const localeKeys =
        preferredLocales.length > 0 ? preferredLocales : Object.keys(localizedValues);

      for (const locale of localeKeys) {
        const localized = valueToString(localizedValues[locale]);
        if (localized) {
          return localized;
        }
      }
    }

    const resolved = valueToString(rawValue);
    if (resolved) {
      return resolved;
    }
  }

  return `Record ${String(record.id ?? '')}`;
}

function mapCandidate(
  model: ModelSummary,
  preferredLocales: string[],
  record: ItemRecord,
): CandidateRecord {
  const snapshot = record as Record<string, unknown>;

  return {
    id: record.id,
    modelId: model.id,
    modelName: model.name,
    title: resolveRecordTitle(snapshot, preferredLocales),
    status: readCandidateStatus(snapshot),
    currentVersion: readCurrentVersion(snapshot),
    updatedAt: readUpdatedAt(snapshot),
    selected: true,
    snapshot,
  };
}

function isFallbackTitle(title: string): boolean {
  return title.startsWith('Record ');
}

export function buildSearchCountsFromCandidates(candidates: CandidateRecord[]): SearchCounts {
  const countsByModel = new Map<
    string,
    { modelId: string; modelName: string; count: number }
  >();

  for (const candidate of candidates) {
    const current = countsByModel.get(candidate.modelId);
    if (current) {
      current.count += 1;
      continue;
    }

    countsByModel.set(candidate.modelId, {
      modelId: candidate.modelId,
      modelName: candidate.modelName,
      count: 1,
    });
  }

  const byModel = [...countsByModel.values()].sort((left, right) =>
    left.modelName.localeCompare(right.modelName),
  );

  return {
    total: candidates.length,
    byModel,
  };
}

async function runPlanQuery(
  client: Client,
  model: ModelSummary,
  plan: ModelSearchPlan,
  variants: QueryVariant[],
  override: QueryOverride,
  onRecordScanned?: () => void,
): Promise<Map<string, CandidateRecord>> {
  const results = new Map<string, CandidateRecord>();

  for (const variant of variants) {
    const iterator = client.items.listPagedIterator(
      buildModelQuery(model, plan, variant, override),
      { concurrency: 1, perPage: 30 },
    );

    for await (const record of iterator) {
      const candidate = mapCandidate(
        model,
        variant.locale
          ? [variant.locale, ...plan.locales.filter((locale) => locale !== variant.locale)]
          : plan.locales,
        record as ItemRecord,
      );
      const key = `${candidate.modelId}:${candidate.id}`;
      const existing = results.get(key);

      if (!existing || (isFallbackTitle(existing.title) && !isFallbackTitle(candidate.title))) {
        results.set(key, candidate);
      }

      onRecordScanned?.();
    }
  }

  return results;
}

export async function freezeCandidatesForPlans(
  client: Client,
  models: Map<string, ModelSummary>,
  plans: ModelSearchPlan[],
  onProgress?: (progress: SearchProgress) => void,
): Promise<CandidateRecord[]> {
  const candidatesByKey = new Map<string, CandidateRecord>();
  const plansTotal = plans.length;
  let recordsScanned = 0;
  let lastEmitRecords = 0;

  const emit = (plansCompleted: number, currentPlanLabel: string) => {
    onProgress?.({
      plansTotal,
      plansCompleted,
      currentPlanLabel,
      recordsFrozen: candidatesByKey.size,
      recordsScanned,
    });
  };

  emit(0, 'Starting…');

  for (let planIndex = 0; planIndex < plans.length; planIndex++) {
    const plan = plans[planIndex];
    const model = models.get(plan.modelId);
    if (!model) {
      emit(planIndex + 1, '');
      continue;
    }

    const label = `Scanning ${model.name}…`;
    emit(planIndex, label);

    const onRecordScanned = () => {
      recordsScanned += 1;
      if (recordsScanned - lastEmitRecords >= 25) {
        lastEmitRecords = recordsScanned;
        emit(planIndex, label);
      }
    };

    const queryVariants = expandQueryVariants(plan);
    const globalConditions = plan.globalConditions ?? [];

    let modelResults: Map<string, CandidateRecord>;

    if (globalConditions.length === 0) {
      modelResults = await runPlanQuery(
        client,
        model,
        plan,
        queryVariants,
        {},
        onRecordScanned,
      );
    } else {
      const perConditionResults: Array<Map<string, CandidateRecord>> = [];

      for (const condition of globalConditions) {
        if (condition.operator === 'contains') {
          const result = await runPlanQuery(
            client,
            model,
            plan,
            queryVariants,
            { fullTextQuery: condition.value },
            onRecordScanned,
          );
          perConditionResults.push(result);
        } else {
          const unionForRegex = new Map<string, CandidateRecord>();

          if (plan.textFieldApiKeys.length === 0) {
            perConditionResults.push(unionForRegex);
            continue;
          }

          for (const apiKey of plan.textFieldApiKeys) {
            const fieldResult = await runPlanQuery(
              client,
              model,
              plan,
              queryVariants,
              {
                extraFieldFilter: {
                  [apiKey]: {
                    matches: {
                      pattern: condition.value,
                      case_sensitive: false,
                    },
                  },
                },
              },
              onRecordScanned,
            );

            for (const [key, candidate] of fieldResult) {
              const existing = unionForRegex.get(key);
              if (
                !existing ||
                (isFallbackTitle(existing.title) && !isFallbackTitle(candidate.title))
              ) {
                unionForRegex.set(key, candidate);
              }
            }
          }

          perConditionResults.push(unionForRegex);
        }
      }

      const [firstSet, ...restSets] = perConditionResults;
      modelResults = new Map(firstSet);

      for (const nextSet of restSets) {
        for (const key of modelResults.keys()) {
          if (!nextSet.has(key)) {
            modelResults.delete(key);
          }
        }
      }
    }

    for (const [key, candidate] of modelResults) {
      const existing = candidatesByKey.get(key);
      if (!existing || (isFallbackTitle(existing.title) && !isFallbackTitle(candidate.title))) {
        candidatesByKey.set(key, candidate);
      }
    }

    emit(planIndex + 1, label);
  }

  const candidates = [...candidatesByKey.values()];

  candidates.sort((a, b) => {
    const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;

    if (aTime !== bTime) {
      return bTime - aTime;
    }

    if (a.modelName !== b.modelName) {
      return a.modelName.localeCompare(b.modelName);
    }

    return a.id.localeCompare(b.id);
  });

  return candidates;
}
