import type { RenderPageCtx } from 'datocms-plugin-sdk';
import {
  Button,
  Canvas,
  CaretDownIcon,
  CaretUpIcon,
  Dropdown,
  DropdownMenu,
  DropdownOption,
  SelectField,
  Spinner,
  SwitchField,
  TextField,
} from 'datocms-react-ui';
import type { ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ExecutionProgress,
  ExecutionRow,
  FieldCondition,
  FieldConditionOperator,
  FieldSummary,
  GlobalFieldCondition,
  GlobalFieldConditionOperator,
  ModelSearchPlan,
  ModelSummary,
  OperationPlan,
  OperationType,
  PluginParameters,
  PreparedChange,
  PreviewRow,
  PublicationStatusFilter,
  SearchProgress,
  SearchState,
} from '../types';
import { buildCmaClient } from '../utils/cma';
import {
  downloadBeforeValuesCsv,
  downloadExecutionCsv,
  downloadExecutionJson,
} from '../utils/downloads';
import { buildPreviewChanges, executePreparedChanges } from '../utils/operations';
import { readPluginParameters } from '../utils/parameters';
import { buildPermissionView } from '../utils/permissions';
import {
  buildSearchCountsFromCandidates,
  freezeCandidatesForPlans,
} from '../utils/query';
import { getTextLikeFields, loadFieldsForModel, loadModels, loadSiteLocales } from '../utils/schema';
import s from './WorkbenchPage.module.css';

type Props = {
  ctx: RenderPageCtx;
};

type SelectOption = {
  label: string;
  value: string;
};

type SingleValue<T> = T | null;
type MultiValue<T> = readonly T[];
type SelectChangeValue =
  | SingleValue<SelectOption>
  | MultiValue<SelectOption>
  | readonly (SelectOption | MultiValue<SelectOption>)[];

type ConditionDraft = {
  id: string;
  fieldId: string;
  operator: FieldConditionOperator;
  value: string;
};

type OperationMappingDraft = {
  targetFieldId: string;
  sourceFieldId: string;
};

type GlobalConditionDraft = {
  id: string;
  operator: GlobalFieldConditionOperator;
  value: string;
};

type StepId = 1 | 2 | 3 | 4;

const STEP_TITLES: Record<StepId, string> = {
  1: 'Scope',
  2: 'Operation',
  3: 'Preview',
  4: 'Execute',
};

const stepIconSharedProps = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

function ScopeIcon() {
  return (
    <svg {...stepIconSharedProps}>
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}

function OperationIcon() {
  return (
    <svg {...stepIconSharedProps}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function PreviewIcon() {
  return (
    <svg {...stepIconSharedProps}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function ExecuteIcon() {
  return (
    <svg {...stepIconSharedProps}>
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

const STEP_ICONS: Record<StepId, () => ReactElement> = {
  1: ScopeIcon,
  2: OperationIcon,
  3: PreviewIcon,
  4: ExecuteIcon,
};

const EMPTY_SEARCH_STATE: SearchState = {
  counts: null,
  candidates: [],
  frozenAt: null,
};

const EMPTY_PROGRESS: ExecutionProgress = {
  total: 0,
  completed: 0,
  success: 0,
  failed: 0,
  skipped: 0,
  currentLabel: 'Idle',
};

const EXECUTION_BATCH_SIZE = 50;
const EXECUTION_CONCURRENCY = 5;

const CONDITION_OPERATOR_OPTIONS: SelectOption[] = [
  { value: 'matches', label: 'Contains' },
  { value: 'eq', label: 'Equals' },
  { value: 'neq', label: 'Not equal' },
  { value: 'exists', label: 'Has value' },
  { value: 'not_exists', label: 'Is empty' },
];

const GLOBAL_CONDITION_OPERATOR_OPTIONS: SelectOption[] = [
  { value: 'contains', label: 'Contains (any text field)' },
  { value: 'regex', label: 'Regex (any text field)' },
];

function isGlobalConditionOperator(
  value: string,
): value is GlobalFieldConditionOperator {
  return value === 'contains' || value === 'regex';
}

function createGlobalConditionDraft(): GlobalConditionDraft {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    operator: 'contains',
    value: '',
  };
}

const STATUS_OPTIONS: Array<{ value: PublicationStatusFilter; label: string }> = [
  { value: 'draft', label: 'Draft' },
  { value: 'updated', label: 'Updated' },
  { value: 'published', label: 'Published' },
  { value: 'all', label: 'All statuses' },
];

function createConditionDraft(): ConditionDraft {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    fieldId: '',
    operator: 'matches',
    value: '',
  };
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return '—';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function countPreviewOutcomes(rows: PreviewRow[]) {
  return rows.reduce(
    (summary, row) => {
      summary[row.outcome] += 1;
      return summary;
    },
    { change: 0, no_change: 0, skip: 0, invalid: 0 },
  );
}

function countExecutionStatuses(rows: ExecutionRow[]) {
  return rows.reduce(
    (summary, row) => {
      summary[row.status] += 1;
      return summary;
    },
    { success: 0, skipped: 0, failed: 0 },
  );
}

function requiresInputValue(operator: FieldConditionOperator): boolean {
  return operator === 'eq' || operator === 'neq' || operator === 'matches';
}

function isOperationType(value: string): value is OperationType {
  return [
    'findReplace',
    'prepend',
    'append',
    'setFixedValue',
    'clearValue',
    'copyField',
  ].includes(value);
}

function isSelectOption(value: unknown): value is SelectOption {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    'label' in (value as Record<string, unknown>) &&
    'value' in (value as Record<string, unknown>)
  );
}

function toOptionArray(value: SelectChangeValue): SelectOption[] {
  if (!Array.isArray(value)) {
    return isSelectOption(value) ? [value] : [];
  }

  const options: SelectOption[] = [];

  for (const entry of value) {
    if (Array.isArray(entry)) {
      for (const nested of entry) {
        if (isSelectOption(nested)) {
          options.push(nested);
        }
      }
      continue;
    }

    if (isSelectOption(entry)) {
      options.push(entry);
    }
  }

  return options;
}

function toSingleOption(value: SelectChangeValue): SelectOption | null {
  const [first] = toOptionArray(value);
  return first ?? null;
}

function fieldOptions(fields: FieldSummary[]): SelectOption[] {
  return getTextLikeFields(fields).map((field) => ({
    value: field.id,
    label: field.localized ? `${field.api_key} (localized)` : field.api_key,
  }));
}

function buildSearchPlans(args: {
  selectedModelIds: string[];
  localeIds: string[];
  publicationStatuses: PublicationStatusFilter[];
  fieldConditionsByModelId: Record<string, ConditionDraft[]>;
  fieldsByModelId: Record<string, FieldSummary[]>;
  globalConditionDrafts: GlobalConditionDraft[];
}): { plans?: ModelSearchPlan[]; error?: string } {
  const globalConditions: GlobalFieldCondition[] = [];

  for (const draft of args.globalConditionDrafts) {
    const trimmed = draft.value.trim();
    if (trimmed === '') {
      return { error: 'Global condition rows need a value.' };
    }

    if (draft.operator === 'regex') {
      try {
        new RegExp(trimmed);
      } catch {
        return { error: `Invalid regex in global condition: ${trimmed}` };
      }
    }

    globalConditions.push({ operator: draft.operator, value: trimmed });
  }

  const plans: ModelSearchPlan[] = [];

  for (const modelId of args.selectedModelIds) {
    const drafts = args.fieldConditionsByModelId[modelId] ?? [];
    const fields = args.fieldsByModelId[modelId] ?? [];
    const fieldMap = new Map(fields.map((field) => [field.id, field]));
    const conditions: FieldCondition[] = [];

    for (const draft of drafts) {
      if (!draft.fieldId) {
        continue;
      }

      const field = fieldMap.get(draft.fieldId);
      if (!field) {
        return { error: 'One or more search conditions reference a missing field.' };
      }

      if (requiresInputValue(draft.operator) && draft.value.trim() === '') {
        return { error: `Search condition for ${field.api_key} needs a value.` };
      }

      conditions.push({
        fieldId: draft.fieldId,
        apiKey: field.api_key,
        operator: draft.operator,
        ...(requiresInputValue(draft.operator)
          ? { value: draft.value.trim() }
          : {}),
      });
    }

    const textFieldApiKeys = getTextLikeFields(fields).map((field) => field.api_key);

    plans.push({
      modelId,
      locales: args.localeIds,
      publicationStatuses: args.publicationStatuses,
      fieldConditions: conditions,
      globalConditions,
      textFieldApiKeys,
    });
  }

  return { plans };
}

function buildOperationPlan(args: {
  selectedModelIds: string[];
  operationType: OperationType;
  operationMappings: Record<string, OperationMappingDraft>;
  findValue: string;
  replaceValue: string;
  fixedValue: string;
  onlyIfEmpty: boolean;
}): { plan?: OperationPlan; error?: string } {
  const perModel = args.selectedModelIds.map((modelId) => ({
    modelId,
    ...args.operationMappings[modelId],
  }));

  if (perModel.some((mapping) => !mapping.targetFieldId)) {
    return { error: 'Choose a target field for every selected model.' };
  }

  switch (args.operationType) {
    case 'findReplace':
      return {
        plan: {
          type: 'findReplace',
          perModel: perModel.map(({ modelId, targetFieldId }) => ({
            modelId,
            targetFieldId,
          })),
          find: args.findValue,
          replace: args.replaceValue,
        },
      };
    case 'prepend':
      return {
        plan: {
          type: 'prepend',
          perModel: perModel.map(({ modelId, targetFieldId }) => ({
            modelId,
            targetFieldId,
          })),
          value: args.fixedValue,
        },
      };
    case 'append':
      return {
        plan: {
          type: 'append',
          perModel: perModel.map(({ modelId, targetFieldId }) => ({
            modelId,
            targetFieldId,
          })),
          value: args.fixedValue,
        },
      };
    case 'setFixedValue':
      return {
        plan: {
          type: 'setFixedValue',
          perModel: perModel.map(({ modelId, targetFieldId }) => ({
            modelId,
            targetFieldId,
          })),
          value: args.fixedValue,
          onlyIfEmpty: args.onlyIfEmpty,
        },
      };
    case 'clearValue':
      return {
        plan: {
          type: 'clearValue',
          perModel: perModel.map(({ modelId, targetFieldId }) => ({
            modelId,
            targetFieldId,
          })),
        },
      };
    case 'copyField':
      if (perModel.some((mapping) => !mapping.sourceFieldId)) {
        return { error: 'Choose a source field for every selected model.' };
      }
      return {
        plan: {
          type: 'copyField',
          perModel: perModel.map(({ modelId, sourceFieldId, targetFieldId }) => ({
            modelId,
            sourceFieldId,
            targetFieldId,
          })),
          onlyIfEmpty: args.onlyIfEmpty,
        },
      };
  }
}

function renderStatusChip(status: string) {
  return <span className={s.statusChip}>{status}</span>;
}

function extractNonEmptyStringValues(raw: unknown): string[] {
  if (raw == null) return [];
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed === '' ? [] : [trimmed];
  }
  if (typeof raw === 'number' || typeof raw === 'boolean') {
    return [String(raw)];
  }
  if (Array.isArray(raw)) return raw.flatMap(extractNonEmptyStringValues);
  if (typeof raw === 'object') {
    return Object.values(raw as Record<string, unknown>).flatMap(
      extractNonEmptyStringValues,
    );
  }
  return [];
}

function truncate(value: string, max = 80): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

type Snippet = { before: string; match: string; after: string };

type MatchingEntry = { apiKey: string; snippet: Snippet };

function buildSnippet(value: string, matchStart: number, matchLength: number): Snippet {
  const windowStart = Math.max(0, matchStart - 20);
  const windowEnd = Math.min(value.length, matchStart + matchLength + 40);
  const prefix = windowStart > 0 ? '…' : '';
  const suffix = windowEnd < value.length ? '…' : '';
  return {
    before: `${prefix}${value.slice(windowStart, matchStart)}`,
    match: value.slice(matchStart, matchStart + matchLength),
    after: `${value.slice(matchStart + matchLength, windowEnd)}${suffix}`,
  };
}

function findContainingSnippet(values: string[], needle: string): Snippet | null {
  const lowerNeedle = needle.toLowerCase();
  for (const value of values) {
    const idx = value.toLowerCase().indexOf(lowerNeedle);
    if (idx >= 0) return buildSnippet(value, idx, needle.length);
  }
  return null;
}

function findRegexSnippet(values: string[], pattern: RegExp): Snippet | null {
  for (const value of values) {
    const match = pattern.exec(value);
    if (match && match.index >= 0) {
      return buildSnippet(value, match.index, match[0].length);
    }
  }
  return null;
}

function computeMatchingEntries(args: {
  snapshot: Record<string, unknown>;
  allFields: FieldSummary[];
  perModelConditions: ConditionDraft[];
  fieldsById: Map<string, FieldSummary>;
  globalConditionDrafts: GlobalConditionDraft[];
}): MatchingEntry[] {
  const firstByApiKey = new Map<string, Snippet>();

  // Scan every field of the model — not just text-like ones — so the match can
  // be found inside structured text, JSON, block content, etc.
  const valuesByApiKey = new Map<string, string[]>();
  for (const field of args.allFields) {
    valuesByApiKey.set(
      field.api_key,
      extractNonEmptyStringValues(args.snapshot[field.api_key]),
    );
  }

  const recordHit = (apiKey: string, snippet: Snippet) => {
    if (!firstByApiKey.has(apiKey)) firstByApiKey.set(apiKey, snippet);
  };

  for (const draft of args.perModelConditions) {
    if (!draft.fieldId) continue;
    const field = args.fieldsById.get(draft.fieldId);
    if (!field) continue;
    const values = valuesByApiKey.get(field.api_key) ?? [];
    const first = values[0];
    if (first) {
      recordHit(field.api_key, { before: truncate(first, 100), match: '', after: '' });
    }
  }

  for (const draft of args.globalConditionDrafts) {
    const value = draft.value.trim();
    if (value === '') continue;

    if (draft.operator === 'contains') {
      for (const [apiKey, values] of valuesByApiKey) {
        const snippet = findContainingSnippet(values, value);
        if (snippet) recordHit(apiKey, snippet);
      }
    } else {
      let pattern: RegExp;
      try {
        pattern = new RegExp(value, 'i');
      } catch {
        continue;
      }
      for (const [apiKey, values] of valuesByApiKey) {
        const snippet = findRegexSnippet(values, pattern);
        if (snippet) recordHit(apiKey, snippet);
      }
    }
  }

  return [...firstByApiKey]
    .map(([apiKey, snippet]) => ({ apiKey, snippet }))
    .sort((a, b) => a.apiKey.localeCompare(b.apiKey));
}

const RESULTS_PAGE_SIZE = 20;

export default function WorkbenchPage({ ctx }: Props) {
  const params = useMemo<PluginParameters>(
    () => readPluginParameters(ctx.plugin.attributes.parameters),
    [ctx.plugin.attributes.parameters],
  );
  const client = useMemo(
    () => (ctx.currentUserAccessToken ? buildCmaClient(ctx) : null),
    [ctx.currentUserAccessToken, ctx.environment],
  );

  const [allModels, setAllModels] = useState<ModelSummary[]>([]);
  const [fieldsByModelId, setFieldsByModelId] = useState<Record<string, FieldSummary[]>>({});
  const [locales, setLocales] = useState<string[]>([]);
  const [isBootLoading, setIsBootLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const [useAllModels, setUseAllModels] = useState(true);
  const [useAllLocales, setUseAllLocales] = useState(true);
  const [useAllStatuses, setUseAllStatuses] = useState(true);
  const [selectedLocaleIds, setSelectedLocaleIds] = useState<string[]>([]);
  const [selectedPublicationStatuses, setSelectedPublicationStatuses] =
    useState<PublicationStatusFilter[]>(['draft']);
  const [fieldConditionsByModelId, setFieldConditionsByModelId] = useState<
    Record<string, ConditionDraft[]>
  >({});
  const [globalConditionDrafts, setGlobalConditionDrafts] = useState<
    GlobalConditionDraft[]
  >([]);
  const [perModelFilterModelIds, setPerModelFilterModelIds] = useState<string[]>([]);
  const [operationType, setOperationType] = useState<OperationType>('findReplace');
  const [operationMappings, setOperationMappings] = useState<
    Record<string, OperationMappingDraft>
  >({});
  const [findValue, setFindValue] = useState('');
  const [replaceValue, setReplaceValue] = useState('');
  const [fixedValue, setFixedValue] = useState('');
  const [onlyIfEmpty, setOnlyIfEmpty] = useState(false);
  const [searchState, setSearchState] = useState<SearchState>(EMPTY_SEARCH_STATE);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [preparedChanges, setPreparedChanges] = useState<PreparedChange[]>([]);
  const [beforeValuesExported, setBeforeValuesExported] = useState(false);
  const [executionRows, setExecutionRows] = useState<ExecutionRow[]>([]);
  const [executionProgress, setExecutionProgress] =
    useState<ExecutionProgress>(EMPTY_PROGRESS);
  const [pageError, setPageError] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState<StepId>(1);
  const [searchProgress, setSearchProgress] = useState<SearchProgress | null>(null);
  const [resultsPage, setResultsPage] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialData() {
      if (!client) {
        setIsBootLoading(false);
        return;
      }

      setIsBootLoading(true);
      setPageError(null);

      try {
        const [nextModels, nextLocales] = await Promise.all([
          loadModels(client),
          loadSiteLocales(client),
        ]);

        if (cancelled) {
          return;
        }

        setAllModels(nextModels);
        setLocales(nextLocales);
        setSelectedLocaleIds((current) => current.length > 0 ? current : (nextLocales[0] ? [nextLocales[0]] : []));
      } catch (error) {
        if (!cancelled) {
          setPageError(error instanceof Error ? error.message : 'Failed to load page data.');
        }
      } finally {
        if (!cancelled) {
          setIsBootLoading(false);
        }
      }
    }

    void loadInitialData();

    return () => {
      cancelled = true;
    };
  }, [client]);

  const permissionView = useMemo(
    () =>
      buildPermissionView({
        role: ctx.currentRole,
        environment: ctx.environment,
        params,
        tokenAvailable: Boolean(ctx.currentUserAccessToken),
        models: allModels,
      }),
    [allModels, ctx.currentRole, ctx.currentUserAccessToken, ctx.environment, params],
  );

  const visibleModels = useMemo(
    () => allModels.filter((model) => permissionView.allowedModelIds.has(model.id)),
    [allModels, permissionView.allowedModelIds],
  );

  const modelsById = useMemo(
    () => new Map(visibleModels.map((model) => [model.id, model])),
    [visibleModels],
  );

  const modelOptions = useMemo<SelectOption[]>(
    () => visibleModels.map((model) => ({ label: model.name, value: model.id })),
    [visibleModels],
  );

  const localeOptions = useMemo<SelectOption[]>(
    () => locales.map((value) => ({ label: value, value })),
    [locales],
  );

  const statusOptions = useMemo<SelectOption[]>(
    () =>
      STATUS_OPTIONS.filter((option) => option.value !== 'all').map((option) => ({
        value: option.value,
        label: option.label,
      })),
    [],
  );

  const operationOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'findReplace', label: 'Find / replace' },
      { value: 'prepend', label: 'Prepend' },
      { value: 'append', label: 'Append' },
      { value: 'setFixedValue', label: 'Set fixed value' },
      { value: 'copyField', label: 'Copy field A to B' },
      { value: 'clearValue', label: 'Clear value' },
    ],
    [],
  );

  useEffect(() => {
    setSelectedModelIds((current) => {
      if (useAllModels) {
        return visibleModels.map((model) => model.id);
      }

      return current.filter((modelId) => permissionView.allowedModelIds.has(modelId));
    });
  }, [permissionView.allowedModelIds, useAllModels, visibleModels]);

  const resetPreviewState = useCallback(() => {
    setPreviewRows([]);
    setPreparedChanges([]);
    setBeforeValuesExported(false);
    setExecutionRows([]);
    setExecutionProgress(EMPTY_PROGRESS);
    setActiveStep((current) => (current > 3 ? 3 : current));
  }, []);

  const resetSearchState = useCallback(() => {
    setSearchState(EMPTY_SEARCH_STATE);
    resetPreviewState();
    setActiveStep((current) => (current > 1 ? 1 : current));
  }, [resetPreviewState]);

  const ensureFieldsLoaded = useCallback(
    async (modelIds: string[]) => {
      if (!client) {
        return;
      }

      const missing = modelIds.filter((modelId) => !(modelId in fieldsByModelId));
      if (missing.length === 0) {
        return;
      }

      const entries = await Promise.all(
        missing.map(async (modelId) => [modelId, await loadFieldsForModel(client, modelId)] as const),
      );

      setFieldsByModelId((current) => ({
        ...current,
        ...Object.fromEntries(entries),
      }));
    },
    [client, fieldsByModelId],
  );

  useEffect(() => {
    if (selectedModelIds.length === 0) {
      return;
    }

    void ensureFieldsLoaded(selectedModelIds);
  }, [ensureFieldsLoaded, selectedModelIds]);

  useEffect(() => {
    const scopedIds = new Set(selectedModelIds);
    setPerModelFilterModelIds((current) =>
      current.filter((modelId) => scopedIds.has(modelId)),
    );
  }, [selectedModelIds]);

  const selectedCandidates = useMemo(
    () => searchState.candidates.filter((candidate) => candidate.selected),
    [searchState.candidates],
  );

  const matchingEntriesByCandidate = useMemo(() => {
    const map = new Map<string, MatchingEntry[]>();
    if (searchState.candidates.length === 0) return map;

    for (const candidate of searchState.candidates) {
      const fields = fieldsByModelId[candidate.modelId] ?? [];
      const fieldsById = new Map(fields.map((field) => [field.id, field]));
      const perModelConditions = fieldConditionsByModelId[candidate.modelId] ?? [];

      map.set(
        candidate.id,
        computeMatchingEntries({
          snapshot: candidate.snapshot,
          allFields: fields,
          perModelConditions,
          fieldsById,
          globalConditionDrafts,
        }),
      );
    }

    return map;
  }, [
    searchState.candidates,
    fieldsByModelId,
    fieldConditionsByModelId,
    globalConditionDrafts,
  ]);

  const resultsTotalPages = Math.max(
    1,
    Math.ceil(searchState.candidates.length / RESULTS_PAGE_SIZE),
  );
  const clampedResultsPage = Math.min(resultsPage, resultsTotalPages - 1);
  const pagedResults = searchState.candidates.slice(
    clampedResultsPage * RESULTS_PAGE_SIZE,
    clampedResultsPage * RESULTS_PAGE_SIZE + RESULTS_PAGE_SIZE,
  );

  const previewSummary = useMemo(() => countPreviewOutcomes(previewRows), [previewRows]);
  const executionSummary = useMemo(
    () => countExecutionStatuses(executionRows),
    [executionRows],
  );

  const hasFrozenCandidates =
    searchState.frozenAt !== null && searchState.candidates.length > 0;
  const hasBuiltPreview = previewRows.length > 0;
  const canExecute =
    hasBuiltPreview && preparedChanges.length > 0 && beforeValuesExported;

  const canAccessStep = (step: StepId) => {
    if (step === 1) return true;
    if (step === 2) return hasFrozenCandidates;
    if (step === 3) return hasFrozenCandidates;
    return canExecute;
  };

  const goToStep = (step: StepId) => {
    if (canAccessStep(step)) {
      setActiveStep(step);
    }
  };

  function updateConditions(
    modelId: string,
    updater: (current: ConditionDraft[]) => ConditionDraft[],
  ) {
    setFieldConditionsByModelId((current) => ({
      ...current,
      [modelId]: updater(current[modelId] ?? []),
    }));
    resetSearchState();
  }

  function updateGlobalConditions(
    updater: (current: GlobalConditionDraft[]) => GlobalConditionDraft[],
  ) {
    setGlobalConditionDrafts((current) => updater(current));
    resetSearchState();
  }

  const perModelFilterAvailableOptions = useMemo(
    () =>
      modelOptions.filter((option) => !perModelFilterModelIds.includes(option.value)),
    [modelOptions, perModelFilterModelIds],
  );

  function addPerModelFilter(modelId: string) {
    if (!modelId || perModelFilterModelIds.includes(modelId)) {
      return;
    }
    setPerModelFilterModelIds((current) => [...current, modelId]);
    setFieldConditionsByModelId((current) =>
      modelId in current ? current : { ...current, [modelId]: [] },
    );
  }

  function removePerModelFilter(modelId: string) {
    setPerModelFilterModelIds((current) =>
      current.filter((entry) => entry !== modelId),
    );
    setFieldConditionsByModelId((current) => {
      if (!(modelId in current)) return current;
      const { [modelId]: _removed, ...rest } = current;
      return rest;
    });
    resetSearchState();
  }

  function updateOperationMapping(
    modelId: string,
    next: Partial<OperationMappingDraft>,
  ) {
    setOperationMappings((current) => ({
      ...current,
      [modelId]: {
        targetFieldId: current[modelId]?.targetFieldId ?? '',
        sourceFieldId: current[modelId]?.sourceFieldId ?? '',
        ...next,
      },
    }));
    resetPreviewState();
  }

  async function handleSearch(): Promise<void> {
    if (!client) {
      ctx.alert('Grant currentUserAccessToken to use this page.');
      return;
    }

    if (selectedModelIds.length === 0) {
      ctx.alert('Choose at least one model before searching.');
      return;
    }

    if (!useAllLocales && selectedLocaleIds.length === 0) {
      ctx.alert('Choose at least one locale or switch back to All locales.');
      return;
    }

    if (!useAllStatuses && selectedPublicationStatuses.length === 0) {
      ctx.alert('Choose at least one publication status or switch back to All statuses.');
      return;
    }

    setIsSearching(true);
    setPageError(null);
    resetPreviewState();
    setResultsPage(0);
    setSearchProgress({
      plansTotal: selectedModelIds.length,
      plansCompleted: 0,
      currentPlanLabel: 'Starting…',
      recordsFrozen: 0,
      recordsScanned: 0,
    });

    try {
      await ensureFieldsLoaded(selectedModelIds);

      const { plans, error } = buildSearchPlans({
        selectedModelIds,
        localeIds: useAllLocales ? [] : selectedLocaleIds,
        publicationStatuses: useAllStatuses ? [] : selectedPublicationStatuses,
        fieldConditionsByModelId,
        fieldsByModelId,
        globalConditionDrafts,
      });

      if (!plans || error) {
        ctx.alert(error ?? 'Could not build the search plan.');
        return;
      }

      const candidates = await freezeCandidatesForPlans(
        client,
        modelsById,
        plans,
        setSearchProgress,
      );
      const counts = buildSearchCountsFromCandidates(candidates);

      if (counts.total === 0) {
        setSearchState({ counts, candidates: [], frozenAt: null });
        ctx.notice('No matching records found.');
        return;
      }

      setSearchState({
        counts,
        candidates,
        frozenAt: new Date().toISOString(),
      });
      ctx.notice(`Frozen ${candidates.length} matching records.`);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Search failed.');
    } finally {
      setIsSearching(false);
      setSearchProgress(null);
    }
  }

  function handlePreview(): void {
    if (selectedCandidates.length === 0) {
      ctx.alert('Select at least one frozen record before previewing changes.');
      return;
    }

    if (!useAllLocales && selectedLocaleIds.length === 0) {
      ctx.alert('Choose at least one locale or switch back to All locales before previewing.');
      return;
    }

    const { plan, error } = buildOperationPlan({
      selectedModelIds,
      operationType,
      operationMappings,
      findValue,
      replaceValue,
      fixedValue,
      onlyIfEmpty,
    });

    if (!plan || error) {
      ctx.alert(error ?? 'Could not build the operation plan.');
      return;
    }

    const result = buildPreviewChanges({
      candidates: selectedCandidates,
      plan,
      locales: useAllLocales ? [] : selectedLocaleIds,
      allLocales: locales,
      fieldsByModelId,
    });

    setPreviewRows(result.rows);
    setPreparedChanges(result.preparedChanges);
    setBeforeValuesExported(false);
    setExecutionRows([]);
    setExecutionProgress(EMPTY_PROGRESS);

    ctx.notice(`Preview ready for ${result.rows.length} selected records.`);
  }

  async function handleExecute(): Promise<void> {
    if (!client) {
      ctx.alert('Grant currentUserAccessToken to apply changes.');
      return;
    }

    if (preparedChanges.length === 0) {
      ctx.alert('Build a preview with at least one change before executing.');
      return;
    }

    if (!beforeValuesExported) {
      ctx.alert('Export the before-values CSV before applying changes.');
      return;
    }

    const publishedCount = preparedChanges.filter(
      (change) => change.recordStatus === 'published',
    ).length;
    const isClearRun = operationType === 'clearValue';
    const largeRun = preparedChanges.length > 250;

    const warningParts = [
      `Apply ${preparedChanges.length} prepared updates?`,
      publishedCount > 0
        ? `${publishedCount} record(s) are currently published and may move to Updated.`
        : null,
      isClearRun ? 'This run clears field values.' : null,
      largeRun ? 'This is a large run.' : null,
    ].filter((part): part is string => Boolean(part));

    const confirmed = await ctx.openConfirm({
      title: 'Apply bulk updates',
      content: warningParts.join(' '),
      choices: [{ label: 'Apply changes', value: true, intent: 'negative' }],
      cancel: { label: 'Cancel', value: false },
    });

    if (!confirmed) {
      return;
    }

    setIsExecuting(true);
    setExecutionRows([]);
    setExecutionProgress({
      ...EMPTY_PROGRESS,
      total: preparedChanges.length,
      currentLabel: 'Starting run…',
    });

    try {
      const results = await executePreparedChanges({
        client,
        changes: preparedChanges,
        batchSize: EXECUTION_BATCH_SIZE,
        concurrency: EXECUTION_CONCURRENCY,
        onProgress: setExecutionProgress,
      });

      setExecutionRows(results);
      const failed = results.filter((row) => row.status === 'failed').length;
      const succeeded = results.filter((row) => row.status === 'success').length;

      if (failed > 0) {
        ctx.alert(`Run finished with ${failed} failed updates and ${succeeded} successful updates.`);
      } else {
        ctx.notice(`Run finished. ${succeeded} records updated.`);
      }
    } finally {
      setIsExecuting(false);
    }
  }

  if (isBootLoading) {
    return (
      <Canvas ctx={ctx} noAutoResizer>
        <div className={s.loadingState}>
          <Spinner size={40} />
          <span>Loading workbench…</span>
        </div>
      </Canvas>
    );
  }

  if (!permissionView.canAccessPage) {
    return (
      <Canvas ctx={ctx} noAutoResizer>
        <div className={s.page}>
          <div className={s.frame}>
            <h2 className={s.pageHeading}>Workbench unavailable</h2>
            <p className={s.mutedText}>
              This page requires the current user access token permission and a
              role that can read and update at least one allowed model.
            </p>
            {!ctx.currentUserAccessToken && (
              <p className={s.errorText}>
                The plugin is missing currentUserAccessToken permission.
              </p>
            )}
          </div>
        </div>
      </Canvas>
    );
  }

  return (
    <Canvas ctx={ctx} noAutoResizer>
      <div className={s.page}>
        <div className={s.frame}>
          {pageError && <div className={s.bannerError}>{pageError}</div>}

          <nav className={s.stepper} aria-label="Workbench steps">
            {([1, 2, 3, 4] as const).map((step) => {
              const accessible = canAccessStep(step);
              const isActive = activeStep === step;
              const isDone = step < activeStep && accessible;
              const classes = [
                s.stepTab,
                isActive ? s.stepTabActive : '',
                isDone ? s.stepTabDone : '',
                !accessible ? s.stepTabLocked : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <button
                  key={step}
                  type="button"
                  className={classes}
                  onClick={() => goToStep(step)}
                  disabled={!accessible}
                >
                  <span className={s.stepIndex}>{step}</span>
                  <span className={s.stepIcon}>{STEP_ICONS[step]()}</span>
                  <span className={s.stepTitle}>{STEP_TITLES[step]}</span>
                </button>
              );
            })}
          </nav>

          <div className={s.stepBody}>
            {activeStep === 1 && (
              <>
          <div className={s.panel}>
            <div className={s.fieldGrid}>
              <div className={s.fieldBlock}>
                <div className={s.fieldLabel}>Models</div>
                <div className={s.fieldHint}>
                  Choose one or more models to search.
                </div>
                <div className={s.scopeSwitch}>
                  <SwitchField
                    id="useAllModels"
                    name="useAllModels"
                    label="Include all visible models"
                    value={useAllModels}
                    onChange={(value) => {
                      setUseAllModels(value);
                      resetSearchState();
                    }}
                  />
                </div>
                {!useAllModels && (
                  <SelectField
                    id="models"
                    name="models"
                    label=""
                    value={modelOptions.filter((option) =>
                      selectedModelIds.includes(option.value),
                    )}
                    selectInputProps={{
                      options: modelOptions,
                      isMulti: true,
                      closeMenuOnSelect: false,
                    }}
                    onChange={(value) => {
                      const nextIds = toOptionArray(value).map((entry) => entry.value);
                      setSelectedModelIds(nextIds);
                      resetSearchState();
                    }}
                  />
                )}
              </div>
              <div className={s.fieldBlock}>
                <div className={s.fieldLabel}>Locale</div>
                <div className={s.fieldHint}>
                  Used for localized filters and operations.
                </div>
                <div className={s.scopeSwitch}>
                  <SwitchField
                    id="useAllLocales"
                    name="useAllLocales"
                    label="Include all site locales"
                    value={useAllLocales}
                    onChange={(value) => {
                      if (!value && selectedLocaleIds.length === 0 && locales[0]) {
                        setSelectedLocaleIds([locales[0]]);
                      }
                      setUseAllLocales(value);
                      resetSearchState();
                    }}
                  />
                </div>
                {!useAllLocales && (
                  <SelectField
                    id="locale"
                    name="locale"
                    label=""
                    value={localeOptions.filter((option) =>
                      selectedLocaleIds.includes(option.value),
                    )}
                    selectInputProps={{
                      options: localeOptions,
                      isMulti: true,
                      closeMenuOnSelect: false,
                    }}
                    onChange={(value) => {
                      setSelectedLocaleIds(
                        toOptionArray(value).map((entry) => entry.value),
                      );
                      resetSearchState();
                    }}
                  />
                )}
              </div>
              <div className={s.fieldBlock}>
                <div className={s.fieldLabel}>Publication status</div>
                <div className={s.fieldHint}>
                  Filter by draft, updated, or published when needed.
                </div>
                <div className={s.scopeSwitch}>
                  <SwitchField
                    id="useAllStatuses"
                    name="useAllStatuses"
                    label="Include every publication status"
                    value={useAllStatuses}
                    onChange={(value) => {
                      if (!value && selectedPublicationStatuses.length === 0) {
                        setSelectedPublicationStatuses(['draft']);
                      }
                      setUseAllStatuses(value);
                      resetSearchState();
                    }}
                  />
                </div>
                {!useAllStatuses && (
                  <SelectField
                    id="publicationStatus"
                    name="publicationStatus"
                    label=""
                    value={statusOptions.filter((option) =>
                      selectedPublicationStatuses.includes(
                        option.value as PublicationStatusFilter,
                      ),
                    )}
                    selectInputProps={{
                      options: statusOptions,
                      isMulti: true,
                      closeMenuOnSelect: false,
                    }}
                    onChange={(value) => {
                      setSelectedPublicationStatuses(
                        toOptionArray(value).map(
                          (entry) => entry.value as PublicationStatusFilter,
                        ),
                      );
                      resetSearchState();
                    }}
                  />
                )}
              </div>
            </div>

            <div className={s.inlineSection}>
              <div className={s.inlineBody}>
                <div className={s.inlineHeader}>
                  <h3 className={s.subheading}>Global conditions</h3>
                  <div className={s.fieldHint}>
                    Apply across any text-like field of the selected models.
                  </div>
                </div>

                <div>
                  <Button
                    buttonType="muted"
                    buttonSize="xs"
                    onClick={() =>
                      updateGlobalConditions((current) => [
                        ...current,
                        createGlobalConditionDraft(),
                      ])
                    }
                  >
                    Add global condition
                  </Button>
                </div>

                {globalConditionDrafts.length > 0 && (
                <div className={s.stack}>
                  {globalConditionDrafts.map((draft) => (
                    <div key={draft.id} className={s.conditionRow}>
                      <div className={s.conditionFieldSmall}>
                        <SelectField
                          id={`${draft.id}-global-operator`}
                          name={`${draft.id}-global-operator`}
                          label="Match"
                          value={
                            GLOBAL_CONDITION_OPERATOR_OPTIONS.find(
                              (option) => option.value === draft.operator,
                            ) ?? null
                          }
                          selectInputProps={{ options: GLOBAL_CONDITION_OPERATOR_OPTIONS }}
                          onChange={(value) => {
                            const nextOp = toSingleOption(value)?.value;
                            if (!nextOp || !isGlobalConditionOperator(nextOp)) return;
                            updateGlobalConditions((current) =>
                              current.map((entry) =>
                                entry.id === draft.id
                                  ? { ...entry, operator: nextOp }
                                  : entry,
                              ),
                            );
                          }}
                        />
                      </div>
                      <div className={s.conditionFieldLarge} style={{ gridColumn: 'span 2' }}>
                        <TextField
                          id={`${draft.id}-global-value`}
                          name={`${draft.id}-global-value`}
                          label={draft.operator === 'regex' ? 'Pattern' : 'Text'}
                          value={draft.value}
                          onChange={(value) => {
                            updateGlobalConditions((current) =>
                              current.map((entry) =>
                                entry.id === draft.id ? { ...entry, value } : entry,
                              ),
                            );
                          }}
                        />
                      </div>
                      <div className={s.conditionAction}>
                        <Button
                          buttonType="negative"
                          buttonSize="xs"
                          onClick={() =>
                            updateGlobalConditions((current) =>
                              current.filter((entry) => entry.id !== draft.id),
                            )
                          }
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
                )}
              </div>
            </div>

            <div className={s.inlineSection}>
              <div className={s.inlineBody}>
                <div className={s.inlineHeader}>
                  <h3 className={s.subheading}>Model-specific conditions</h3>
                  <div className={s.fieldHint}>
                    Add conditions targeting a specific field on a specific model.
                  </div>
                </div>

                {selectedModelIds.length === 0 ? (
                  <p className={s.mutedText}>
                    Select models above to add model-specific conditions.
                  </p>
                ) : perModelFilterAvailableOptions.length > 0 ? (
                  <div>
                    <Dropdown
                      renderTrigger={({ open, onClick }) => (
                        <Button
                          buttonType="muted"
                          buttonSize="xs"
                          onClick={onClick}
                          rightIcon={open ? <CaretUpIcon /> : <CaretDownIcon />}
                        >
                          Add condition for model…
                        </Button>
                      )}
                    >
                      <DropdownMenu>
                        {perModelFilterAvailableOptions.map((option) => (
                          <DropdownOption
                            key={option.value}
                            onClick={() => addPerModelFilter(option.value)}
                          >
                            {option.label}
                          </DropdownOption>
                        ))}
                      </DropdownMenu>
                    </Dropdown>
                  </div>
                ) : null}

                {perModelFilterModelIds.length > 0 && (
                  <div className={s.stack}>
                    {perModelFilterModelIds.map((modelId) => {
                      const model = modelsById.get(modelId);
                      if (!model) return null;

                      const modelFields = fieldsByModelId[modelId] ?? [];
                      const options = fieldOptions(modelFields);
                      const conditionDrafts = fieldConditionsByModelId[modelId] ?? [];

                      return (
                        <div key={modelId} className={s.inlineSection}>
                          <div className={s.inlineBody}>
                            <div className={s.inlineHeader}>
                              <h3 className={s.subheading}>{model.name}</h3>
                            </div>

                            {conditionDrafts.length === 0 ? (
                              <p className={s.mutedText}>
                                No conditions yet for this model.
                              </p>
                            ) : (
                              <div className={s.stack}>
                                {conditionDrafts.map((draft) => (
                                  <div key={draft.id} className={s.conditionRow}>
                                    <div className={s.conditionFieldLarge}>
                                      <SelectField
                                        id={`${draft.id}-field`}
                                        name={`${draft.id}-field`}
                                        label="Field"
                                        value={
                                          options.find(
                                            (option) => option.value === draft.fieldId,
                                          ) ?? null
                                        }
                                        selectInputProps={{ options }}
                                        onChange={(value) => {
                                          updateConditions(modelId, (current) =>
                                            current.map((entry) =>
                                              entry.id === draft.id
                                                ? {
                                                    ...entry,
                                                    fieldId:
                                                      toSingleOption(value)?.value ?? '',
                                                  }
                                                : entry,
                                            ),
                                          );
                                        }}
                                      />
                                    </div>
                                    <div className={s.conditionFieldSmall}>
                                      <SelectField
                                        id={`${draft.id}-operator`}
                                        name={`${draft.id}-operator`}
                                        label="Operator"
                                        value={
                                          CONDITION_OPERATOR_OPTIONS.find(
                                            (option) => option.value === draft.operator,
                                          ) ?? null
                                        }
                                        selectInputProps={{
                                          options: CONDITION_OPERATOR_OPTIONS,
                                        }}
                                        onChange={(value) => {
                                          updateConditions(modelId, (current) =>
                                            current.map((entry) =>
                                              entry.id === draft.id
                                                ? {
                                                    ...entry,
                                                    operator:
                                                      (toSingleOption(value)
                                                        ?.value as
                                                        | FieldConditionOperator
                                                        | undefined) ?? 'matches',
                                                  }
                                                : entry,
                                            ),
                                          );
                                        }}
                                      />
                                    </div>
                                    {requiresInputValue(draft.operator) && (
                                      <div className={s.conditionFieldLarge}>
                                        <TextField
                                          id={`${draft.id}-value`}
                                          name={`${draft.id}-value`}
                                          label="Value"
                                          value={draft.value}
                                          onChange={(value) => {
                                            updateConditions(modelId, (current) =>
                                              current.map((entry) =>
                                                entry.id === draft.id
                                                  ? { ...entry, value }
                                                  : entry,
                                              ),
                                            );
                                          }}
                                        />
                                      </div>
                                    )}
                                    <div className={s.conditionAction}>
                                      <Button
                                        buttonType="negative"
                                        buttonSize="xs"
                                        onClick={() =>
                                          updateConditions(modelId, (current) =>
                                            current.filter(
                                              (entry) => entry.id !== draft.id,
                                            ),
                                          )
                                        }
                                      >
                                        Remove
                                      </Button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className={s.inlineAction}>
                            <div className={s.buttonCluster}>
                              <Button
                                buttonType="muted"
                                buttonSize="xs"
                                onClick={() =>
                                  updateConditions(modelId, (current) => [
                                    ...current,
                                    createConditionDraft(),
                                  ])
                                }
                              >
                                Add condition
                              </Button>
                              <Button
                                buttonType="negative"
                                buttonSize="xs"
                                onClick={() => removePerModelFilter(modelId)}
                              >
                                Remove model
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className={s.actionsRow}>
              <div className={s.summaryText}>
                {!isSearching && searchState.counts && (
                  <>
                    <strong>{searchState.counts.total}</strong> records matched in the
                    current scope.
                  </>
                )}
              </div>
              <div className={s.buttonCluster}>
                <Button
                  onClick={handleSearch}
                  disabled={isSearching || selectedModelIds.length === 0}
                >
                  {isSearching ? (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <Spinner size={14} />
                      Searching…
                    </span>
                  ) : (
                    'Search and freeze records'
                  )}
                </Button>
                <Button
                  buttonType="primary"
                  onClick={() => goToStep(2)}
                  disabled={!canAccessStep(2)}
                >
                  Continue
                </Button>
              </div>
            </div>

            {isSearching && searchProgress && (
              <div className={s.progressPanel}>
                <div className={s.progressMeta}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <Spinner size={16} />
                    {searchProgress.currentPlanLabel || 'Starting…'}
                  </span>
                  <span>
                    {searchProgress.plansCompleted}/{searchProgress.plansTotal} models
                    {' · '}
                    {searchProgress.recordsScanned} scanned
                    {' · '}
                    {searchProgress.recordsFrozen} frozen
                  </span>
                </div>
                <div className={s.progressTrack}>
                  <div
                    className={s.progressFill}
                    style={{
                      width: `${
                        searchProgress.plansTotal > 0
                          ? (searchProgress.plansCompleted /
                              searchProgress.plansTotal) *
                            100
                          : 0
                      }%`,
                    }}
                  />
                </div>
              </div>
            )}

            {!isSearching && searchState.candidates.length > 0 && (
              <div className={s.tableCard}>
                <div>
                  <table className={s.table}>
                    <thead>
                      <tr>
                        <th>Model</th>
                        <th>Record</th>
                        <th>Matching field</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedResults.map((candidate) => {
                        const matching =
                          matchingEntriesByCandidate.get(candidate.id) ?? [];
                        const environmentPrefix = ctx.isEnvironmentPrimary
                          ? ''
                          : `/environments/${ctx.environment}`;
                        const recordUrl = `${environmentPrefix}/editor/item_types/${candidate.modelId}/items/${candidate.id}/edit`;
                        const openRecord = () => {
                          void ctx.navigateTo(recordUrl);
                        };
                        return (
                          <tr
                            key={`${candidate.modelId}:${candidate.id}`}
                            className={s.resultsRow}
                            role="link"
                            tabIndex={0}
                            onClick={openRecord}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                openRecord();
                              }
                            }}
                          >
                            <td>{candidate.modelName}</td>
                            <td>{candidate.title}</td>
                            <td>
                              {matching.length === 0 ? (
                                '—'
                              ) : (
                                <div className={s.matchingList}>
                                  {matching.map((entry) => (
                                    <div key={entry.apiKey} className={s.matchingEntry}>
                                      <span className={s.matchingKey}>
                                        {entry.apiKey}
                                      </span>
                                      <span className={s.matchingValue}>
                                        {entry.snippet.before}
                                        {entry.snippet.match && (
                                          <strong className={s.matchHighlight}>
                                            {entry.snippet.match}
                                          </strong>
                                        )}
                                        {entry.snippet.after}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td>{renderStatusChip(candidate.status)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className={s.pagination}>
                  <span className={s.paginationText}>
                    Page {clampedResultsPage + 1} of {resultsTotalPages}
                    {' · '}
                    {searchState.candidates.length} records
                  </span>
                  <div className={s.buttonCluster}>
                    <Button
                      buttonType="muted"
                      buttonSize="xs"
                      onClick={() => setResultsPage((p) => Math.max(0, p - 1))}
                      disabled={clampedResultsPage === 0}
                    >
                      Previous
                    </Button>
                    <Button
                      buttonType="muted"
                      buttonSize="xs"
                      onClick={() =>
                        setResultsPage((p) =>
                          Math.min(resultsTotalPages - 1, p + 1),
                        )
                      }
                      disabled={clampedResultsPage >= resultsTotalPages - 1}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
              </>
            )}

            {activeStep === 2 && (
              <>
          <div className={s.panel}>
            <div className={s.fieldGrid}>
              <div className={s.fieldBlock}>
                <SelectField
                  id="operationType"
                  name="operationType"
                  label="Operation"
                  hint="One operation per run"
                  value={operationOptions.find((option) => option.value === operationType) ?? null}
                  selectInputProps={{ options: operationOptions }}
                  onChange={(value) => {
                    const option = toSingleOption(value);
                    if (option && isOperationType(option.value)) {
                      setOperationType(option.value);
                      resetPreviewState();
                    }
                  }}
                />
              </div>
              {(operationType === 'setFixedValue' ||
                operationType === 'prepend' ||
                operationType === 'append') && (
                <div className={s.fieldBlock}>
                  <TextField
                    id="fixedValue"
                    name="fixedValue"
                    label="Value"
                    value={fixedValue}
                    onChange={(value) => {
                      setFixedValue(value);
                      resetPreviewState();
                    }}
                  />
                </div>
              )}
              {operationType === 'findReplace' && (
                <>
                  <div className={s.fieldBlock}>
                    <TextField
                      id="findValue"
                      name="findValue"
                      label="Find"
                      value={findValue}
                      onChange={(value) => {
                        setFindValue(value);
                        resetPreviewState();
                      }}
                    />
                  </div>
                  <div className={s.fieldBlock}>
                    <TextField
                      id="replaceValue"
                      name="replaceValue"
                      label="Replace with"
                      value={replaceValue}
                      onChange={(value) => {
                        setReplaceValue(value);
                        resetPreviewState();
                      }}
                    />
                  </div>
                </>
              )}
            </div>

            {(operationType === 'setFixedValue' || operationType === 'copyField') && (
              <div className={s.switchRow}>
                <SwitchField
                  id="onlyIfEmpty"
                  name="onlyIfEmpty"
                  label="Fill empty values only"
                  hint="Skip records where the target field already has content"
                  value={onlyIfEmpty}
                  onChange={(value) => {
                    setOnlyIfEmpty(value);
                    resetPreviewState();
                  }}
                />
              </div>
            )}

            {selectedModelIds.length > 0 ? (
              <div className={s.stack}>
                {selectedModelIds.map((modelId) => {
                  const model = modelsById.get(modelId);
                  if (!model) {
                    return null;
                  }

                  const fields = fieldOptions(fieldsByModelId[modelId] ?? []);
                  const mapping = operationMappings[modelId] ?? {
                    targetFieldId: '',
                    sourceFieldId: '',
                  };

                  return (
                    <div key={modelId} className={s.inlineSection}>
                      <h3 className={s.subheading}>{model.name}</h3>
                      <div className={s.fieldGrid}>
                        <div className={s.fieldBlock}>
                          <SelectField
                            id={`${modelId}-targetField`}
                            name={`${modelId}-targetField`}
                            label="Target field"
                            value={
                              fields.find((option) => option.value === mapping.targetFieldId) ??
                              null
                            }
                            selectInputProps={{ options: fields }}
                            onChange={(value) =>
                              updateOperationMapping(modelId, {
                                targetFieldId: toSingleOption(value)?.value ?? '',
                              })
                            }
                          />
                        </div>
                        {operationType === 'copyField' && (
                          <div className={s.fieldBlock}>
                            <SelectField
                              id={`${modelId}-sourceField`}
                              name={`${modelId}-sourceField`}
                              label="Source field"
                              value={
                                fields.find((option) => option.value === mapping.sourceFieldId) ??
                                null
                              }
                              selectInputProps={{ options: fields }}
                              onChange={(value) =>
                                updateOperationMapping(modelId, {
                                  sourceFieldId: toSingleOption(value)?.value ?? '',
                                })
                              }
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className={s.mutedText}>Choose models in Scope to configure field mappings.</p>
            )}
          </div>
                <div className={s.stepFooter}>
                  <Button buttonType="muted" onClick={() => setActiveStep(1)}>
                    Back
                  </Button>
                  <Button
                    buttonType="primary"
                    onClick={() => goToStep(3)}
                    disabled={!canAccessStep(3)}
                  >
                    Continue
                  </Button>
                </div>
              </>
            )}

            {activeStep === 3 && (
              <>
          <div className={s.panel}>
            <div className={s.actionsRow}>
              <div className={s.summaryText}>
                {searchState.frozenAt ? (
                  <>
                    Frozen <strong>{searchState.candidates.length}</strong> records at{' '}
                    {formatTimestamp(searchState.frozenAt)}.
                  </>
                ) : (
                  'Search first to freeze a candidate set.'
                )}
              </div>
              <div className={s.buttonCluster}>
                <Button
                  buttonType="muted"
                  onClick={() => {
                    setSearchState((current) => ({
                      ...current,
                      candidates: current.candidates.map((candidate) => ({
                        ...candidate,
                        selected: true,
                      })),
                    }));
                    resetPreviewState();
                  }}
                  disabled={searchState.candidates.length === 0}
                >
                  Select all
                </Button>
                <Button onClick={handlePreview} disabled={selectedCandidates.length === 0}>
                  Build preview
                </Button>
              </div>
            </div>

            {searchState.candidates.length > 0 ? (
              <div className={s.tableCard}>
                <div className={s.tableScroll}>
                  <table className={s.table}>
                    <thead>
                      <tr>
                        <th>Use</th>
                        <th>Model</th>
                        <th>Record</th>
                        <th>ID</th>
                        <th>Status</th>
                        <th>Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {searchState.candidates.map((candidate) => (
                        <tr key={candidate.id}>
                          <td>
                            <input
                              type="checkbox"
                              checked={candidate.selected}
                              onChange={(event) => {
                                setSearchState((current) => ({
                                  ...current,
                                  candidates: current.candidates.map((entry) =>
                                    entry.id === candidate.id
                                      ? {
                                          ...entry,
                                          selected: event.target.checked,
                                        }
                                      : entry,
                                  ),
                                }));
                                resetPreviewState();
                              }}
                            />
                          </td>
                          <td>{candidate.modelName}</td>
                          <td>{candidate.title}</td>
                          <td className={s.mono}>{candidate.id}</td>
                          <td>{renderStatusChip(candidate.status)}</td>
                          <td>{formatTimestamp(candidate.updatedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className={s.mutedText}>No frozen candidate set yet.</p>
            )}

            {previewRows.length > 0 && (
              <>
                <div className={s.actionsRow}>
                  <div className={s.summaryText}>
                    Preview summary: <strong>{previewSummary.change}</strong> changes,{' '}
                    <strong>{previewSummary.skip}</strong> skipped,{' '}
                    <strong>{previewSummary.no_change}</strong> unchanged,{' '}
                    <strong>{previewSummary.invalid}</strong> invalid.
                  </div>
                  <Button
                    buttonType={beforeValuesExported ? 'primary' : 'muted'}
                    onClick={() => {
                      downloadBeforeValuesCsv(previewRows);
                      setBeforeValuesExported(true);
                      ctx.notice('Before-values CSV downloaded.');
                    }}
                  >
                    {beforeValuesExported ? 'Before values exported' : 'Export before values CSV'}
                  </Button>
                </div>
                <div className={s.tableCard}>
                  <div className={s.tableScroll}>
                    <table className={s.table}>
                      <thead>
                        <tr>
                          <th>Model</th>
                          <th>Record</th>
                          <th>Target</th>
                          <th>Source</th>
                          <th>Locale</th>
                          <th>Before</th>
                          <th>After</th>
                          <th>Outcome</th>
                          <th>Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row, index) => (
                          <tr key={`${row.recordId}-${row.targetFieldApiKey}-${row.locale ?? 'default'}-${index}`}> 
                            <td>{row.modelName}</td>
                            <td>{row.recordTitle}</td>
                            <td className={s.mono}>{row.targetFieldApiKey}</td>
                            <td className={s.mono}>{row.sourceFieldApiKey ?? '—'}</td>
                            <td>{row.locale ?? '—'}</td>
                            <td>{row.beforeValue ?? '—'}</td>
                            <td>{row.afterValue ?? '—'}</td>
                            <td>{renderStatusChip(row.outcome)}</td>
                            <td>{row.reason ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
                <div className={s.stepFooter}>
                  <Button buttonType="muted" onClick={() => setActiveStep(2)}>
                    Back
                  </Button>
                  <Button
                    buttonType="primary"
                    onClick={() => goToStep(4)}
                    disabled={!canAccessStep(4)}
                  >
                    Continue
                  </Button>
                </div>
              </>
            )}

            {activeStep === 4 && (
              <>
          <div className={s.panel}>
            <div className={s.actionsRow}>
              <div className={s.summaryText}>
                Ready to apply <strong>{preparedChanges.length}</strong> prepared changes.
              </div>
              <Button
                buttonType="primary"
                onClick={() => void handleExecute()}
                disabled={isExecuting || preparedChanges.length === 0 || !beforeValuesExported}
              >
                {isExecuting ? 'Applying…' : 'Apply changes'}
              </Button>
            </div>

            <div className={s.progressPanel}>
              <div className={s.progressMeta}>
                <span>
                  {executionProgress.completed}/{executionProgress.total} complete
                </span>
                <span>{executionProgress.currentLabel}</span>
              </div>
              <div className={s.progressTrack}>
                <div
                  className={s.progressFill}
                  style={{
                    width:
                      executionProgress.total > 0
                        ? `${(executionProgress.completed / executionProgress.total) * 100}%`
                        : '0%',
                  }}
                />
              </div>
            </div>

            {executionRows.length > 0 && (
              <>
                <div className={s.actionsRow}>
                  <div className={s.summaryText}>
                    Run summary: <strong>{executionSummary.success}</strong> success,{' '}
                    <strong>{executionSummary.failed}</strong> failed,{' '}
                    <strong>{executionSummary.skipped}</strong> skipped.
                  </div>
                  <div className={s.buttonCluster}>
                    <Button buttonType="muted" onClick={() => downloadExecutionCsv(executionRows)}>
                      Download CSV report
                    </Button>
                    <Button buttonType="muted" onClick={() => downloadExecutionJson(executionRows)}>
                      Download JSON report
                    </Button>
                  </div>
                </div>
                <div className={s.tableCard}>
                  <div className={s.tableScroll}>
                    <table className={s.table}>
                      <thead>
                        <tr>
                          <th>Model</th>
                          <th>Record</th>
                          <th>ID</th>
                          <th>Status</th>
                          <th>Message</th>
                        </tr>
                      </thead>
                      <tbody>
                        {executionRows.map((row) => (
                          <tr key={`${row.recordId}-${row.status}`}> 
                            <td>{row.modelName}</td>
                            <td>{row.recordTitle}</td>
                            <td className={s.mono}>{row.recordId}</td>
                            <td>{renderStatusChip(row.status)}</td>
                            <td>{row.message ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
                <div className={s.stepFooter}>
                  <Button buttonType="muted" onClick={() => setActiveStep(3)}>
                    Back
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </Canvas>
  );
}
