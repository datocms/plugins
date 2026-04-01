import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Canvas, Section, Spinner } from 'datocms-react-ui';
import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { StageMenuItem } from '../types';
import { buildCmaClient } from '../utils/cma';
import s from './StagePage.module.css';

const PAGE_SIZE = 50;

type Props = {
  ctx: RenderPageCtx;
  menuItem: StageMenuItem | null;
};

type WorkflowItemType = {
  id: string;
  name: string;
  api_key: string;
  modular_block: boolean;
  workflowId: string | null;
  presentationTitleFieldId: string | null;
  presentationTitleFieldApiKey?: string | null;
  titleFieldId: string | null;
  titleFieldApiKey?: string | null;
};

type ResolvedWorkflowItemType = WorkflowItemType & {
  presentationTitleFieldApiKey: string | null;
  titleFieldApiKey: string | null;
};

type ItemRecord = {
  id: string;
  attributes: Record<string, unknown>;
  meta?: {
    stage?: string | null;
    updated_at?: string | null;
  };
};

type Row = {
  id: string;
  itemTypeId: string;
  modelName: string;
  title: string;
  updatedAt: string | null;
};

type ModelOption = {
  value: string;
  label: string;
};

type SortDirection = 'asc' | 'desc';

type SortKey = 'title' | 'id' | 'modelName' | 'updatedAt';

// ─── Display-value extraction helpers ────────────────────────────────────────

function extractFromPrimitive(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

function extractFromArray(value: unknown[], locales: string[]): string | null {
  for (const entry of value) {
    const extracted = extractDisplayValue(entry, locales);
    if (extracted) {
      return extracted;
    }
  }
  return null;
}

function extractFromLocales(
  record: Record<string, unknown>,
  locales: string[],
): string | null {
  for (const locale of locales) {
    const normalizedCandidates = Array.from(
      new Set([locale, locale.split('-')[0]?.trim()].filter(Boolean)),
    ) as string[];

    for (const candidateLocale of normalizedCandidates) {
      if (candidateLocale in record) {
        const localized = extractDisplayValue(record[candidateLocale], locales);
        if (localized) {
          return localized;
        }
      }
    }
  }
  return null;
}

function extractFromPriorityKeys(
  record: Record<string, unknown>,
  locales: string[],
): string | null {
  const priorityKeys = ['title', 'name', 'label', 'value', 'text'];
  for (const key of priorityKeys) {
    if (key in record) {
      const extracted = extractDisplayValue(record[key], locales);
      if (extracted) {
        return extracted;
      }
    }
  }
  return null;
}

function extractFromAllValues(
  record: Record<string, unknown>,
  locales: string[],
): string | null {
  for (const entry of Object.values(record)) {
    const extracted = extractDisplayValue(entry, locales);
    if (extracted) {
      return extracted;
    }
  }
  return null;
}

function extractFromObject(
  value: Record<string, unknown>,
  locales: string[],
): string | null {
  return (
    extractFromLocales(value, locales) ??
    extractFromPriorityKeys(value, locales) ??
    extractFromAllValues(value, locales)
  );
}

function extractDisplayValue(value: unknown, locales: string[]): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const primitiveResult = extractFromPrimitive(value);
  if (primitiveResult !== null) {
    return primitiveResult;
  }

  if (Array.isArray(value)) {
    return extractFromArray(value, locales);
  }

  if (typeof value === 'object') {
    return extractFromObject(value as Record<string, unknown>, locales);
  }

  return null;
}

// ─── Record title resolution helpers ─────────────────────────────────────────

function buildAttributeMap(record: ItemRecord): Record<string, unknown> {
  const rawRecord = record as Record<string, unknown>;
  const hasNestedAttributes =
    rawRecord.attributes != null && typeof rawRecord.attributes === 'object';

  if (hasNestedAttributes) {
    return rawRecord.attributes as Record<string, unknown>;
  }

  const ignoredKeys = new Set([
    'id',
    'type',
    'meta',
    'relationships',
    'item_type',
  ]);

  return Object.fromEntries(
    Object.entries(rawRecord).filter(
      ([key, value]) => !ignoredKeys.has(key) && typeof value !== 'function',
    ),
  );
}

function resolveByFieldKey(
  attributeMap: Record<string, unknown>,
  fieldApiKey: string | null | undefined,
  locales: string[],
): string | null {
  if (!fieldApiKey) {
    return null;
  }
  return extractDisplayValue(attributeMap[fieldApiKey], locales);
}

function resolveRecordTitle(
  record: ItemRecord,
  locales: string[],
  preferredPresentationFieldApiKey?: string | null,
  fallbackTitleFieldApiKey?: string | null,
): string {
  const attributeMap = buildAttributeMap(record);
  const preferredKeys = ['title', 'name', 'heading', 'label'];

  const fromPresentation = resolveByFieldKey(
    attributeMap,
    preferredPresentationFieldApiKey,
    locales,
  );
  if (fromPresentation) {
    return fromPresentation;
  }

  const fromTitle = resolveByFieldKey(
    attributeMap,
    fallbackTitleFieldApiKey,
    locales,
  );
  if (fromTitle) {
    return fromTitle;
  }

  for (const key of preferredKeys) {
    const resolved = extractDisplayValue(attributeMap[key], locales);
    if (resolved) {
      return resolved;
    }
  }

  for (const value of Object.values(attributeMap)) {
    const resolved = extractDisplayValue(value, locales);
    if (resolved) {
      return resolved;
    }
  }

  return `Record ${record.id}`;
}

// ─── Timestamp helpers ────────────────────────────────────────────────────────

function parseUpdatedAt(record: ItemRecord): string | null {
  const metaTimestamp = record.meta?.updated_at;
  if (typeof metaTimestamp === 'string' && metaTimestamp.trim() !== '') {
    return metaTimestamp;
  }

  const attrTimestamp = (record.attributes as Record<string, unknown>)
    ?.updated_at;
  if (typeof attrTimestamp === 'string' && attrTimestamp.trim() !== '') {
    return attrTimestamp;
  }

  return null;
}

function formatTimestamp(timestamp: string | null): string {
  if (!timestamp) {
    return '—';
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return date.toLocaleString();
}

// ─── ItemType mapping helpers ─────────────────────────────────────────────────

type RawItemTypeRecord = Record<string, unknown>;

function resolveFieldId(rawField: unknown): { id?: string } | null {
  if (rawField && typeof rawField === 'object') {
    return rawField as { id?: string };
  }
  return null;
}

function resolveFieldApiKey(rawField: unknown): string | null {
  if (!rawField || typeof rawField !== 'object') {
    return null;
  }
  const asRecord = rawField as Record<string, unknown>;
  const directKey = asRecord.api_key;
  if (typeof directKey === 'string') {
    return directKey;
  }
  const nested = asRecord.attributes;
  if (nested && typeof nested === 'object') {
    const nestedKey = (nested as Record<string, unknown>).api_key;
    if (typeof nestedKey === 'string') {
      return nestedKey;
    }
  }
  return null;
}

function mapRawItemType(rawItemType: RawItemTypeRecord): WorkflowItemType {
  const workflowRel =
    resolveFieldId(rawItemType.workflow) ??
    resolveFieldId(
      (rawItemType.relationships as Record<string, unknown> | undefined)
        ?.workflow,
    ) ??
    null;

  const presentationField =
    resolveFieldId(rawItemType.presentation_title_field) ??
    resolveFieldId(
      (rawItemType.relationships as Record<string, unknown> | undefined)
        ?.presentation_title_field,
    ) ??
    null;

  const titleField =
    resolveFieldId(rawItemType.title_field) ??
    resolveFieldId(
      (rawItemType.relationships as Record<string, unknown> | undefined)
        ?.title_field,
    ) ??
    null;

  const attrs = rawItemType.attributes as Record<string, unknown> | undefined;

  return {
    id: String(rawItemType.id ?? ''),
    name: String(rawItemType.name ?? attrs?.name ?? rawItemType.id ?? ''),
    api_key: String(
      rawItemType.api_key ?? attrs?.api_key ?? rawItemType.id ?? '',
    ),
    modular_block: Boolean(
      typeof rawItemType.modular_block === 'boolean'
        ? rawItemType.modular_block
        : attrs?.modular_block,
    ),
    workflowId: workflowRel?.id ?? null,
    presentationTitleFieldId: presentationField?.id ?? null,
    presentationTitleFieldApiKey:
      resolveFieldApiKey(rawItemType.presentation_title_field) ??
      resolveFieldApiKey(presentationField) ??
      null,
    titleFieldId: titleField?.id ?? null,
    titleFieldApiKey:
      resolveFieldApiKey(rawItemType.title_field) ??
      resolveFieldApiKey(titleField) ??
      null,
  };
}

// ─── Field API key fetching ───────────────────────────────────────────────────

type CmaClient = ReturnType<typeof buildCmaClient>;

type FieldLookupRecord = {
  api_key?: string;
  attributes?: { api_key?: string };
};

function extractApiKeyFromField(field: unknown): string | null {
  if (!field || typeof field !== 'object') {
    return null;
  }
  const fieldRecord = field as FieldLookupRecord;
  return fieldRecord.api_key ?? fieldRecord.attributes?.api_key ?? null;
}

async function prefetchFieldApiKeys(
  client: CmaClient,
  fieldIds: string[],
): Promise<Map<string, string | null>> {
  const cache = new Map<string, string | null>();

  await Promise.allSettled(
    fieldIds.map(async (fieldId) => {
      try {
        const field = await client.fields.find(fieldId);
        cache.set(fieldId, extractApiKeyFromField(field));
      } catch {
        cache.set(fieldId, null);
      }
    }),
  );

  return cache;
}

async function resolveItemTypeFieldKeys(
  itemTypes: WorkflowItemType[],
  client: CmaClient,
): Promise<ResolvedWorkflowItemType[]> {
  // Collect all unique field IDs that need to be fetched from the API
  const fieldIdsToFetch = new Set<string>();
  for (const itemType of itemTypes) {
    if (
      !itemType.presentationTitleFieldApiKey &&
      itemType.presentationTitleFieldId
    ) {
      fieldIdsToFetch.add(itemType.presentationTitleFieldId);
    }
    if (!itemType.titleFieldApiKey && itemType.titleFieldId) {
      fieldIdsToFetch.add(itemType.titleFieldId);
    }
  }

  // Fetch all missing field API keys in parallel (no await in loop)
  const fetchedKeys = await prefetchFieldApiKeys(
    client,
    Array.from(fieldIdsToFetch),
  );

  return itemTypes.map((itemType) => {
    const presentationTitleFieldApiKey =
      itemType.presentationTitleFieldApiKey ??
      (itemType.presentationTitleFieldId
        ? (fetchedKeys.get(itemType.presentationTitleFieldId) ?? null)
        : null);

    const titleFieldApiKey =
      itemType.titleFieldApiKey ??
      (itemType.titleFieldId
        ? (fetchedKeys.get(itemType.titleFieldId) ?? null)
        : null);

    return { ...itemType, presentationTitleFieldApiKey, titleFieldApiKey };
  });
}

// ─── Row collection ───────────────────────────────────────────────────────────

async function collectRowsForItemType(
  client: CmaClient,
  itemType: ResolvedWorkflowItemType,
  stageId: string,
  localePriority: string[],
  isMountedCheck: () => boolean,
): Promise<Row[]> {
  const rows: Row[] = [];
  const iterator = client.items.listPagedIterator({
    filter: { type: itemType.id },
    version: 'current',
    nested: true,
    locale: localePriority[0],
  });

  for await (const record of iterator) {
    if (!isMountedCheck()) {
      break;
    }

    const typedRecord = record as unknown as ItemRecord;

    if (typedRecord.meta?.stage !== stageId) {
      continue;
    }

    const title = resolveRecordTitle(
      typedRecord,
      localePriority,
      itemType.presentationTitleFieldApiKey,
      itemType.titleFieldApiKey,
    );

    rows.push({
      id: typedRecord.id,
      itemTypeId: itemType.id,
      modelName: itemType.name,
      title,
      updatedAt: parseUpdatedAt(typedRecord),
    });
  }

  return rows;
}

// ─── Sorting helper ───────────────────────────────────────────────────────────

function compareRows(
  a: Row,
  b: Row,
  key: SortKey,
  direction: SortDirection,
): number {
  const orderMultiplier = direction === 'asc' ? 1 : -1;
  const compareStrings = (x: string, y: string) =>
    x.localeCompare(y, undefined, { sensitivity: 'base' });

  if (key === 'title') {
    return compareStrings(a.title, b.title) * orderMultiplier;
  }
  if (key === 'id') {
    return compareStrings(a.id, b.id) * orderMultiplier;
  }
  if (key === 'modelName') {
    return compareStrings(a.modelName, b.modelName) * orderMultiplier;
  }
  // 'updatedAt'
  const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
  const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
  if (aTime === bTime) {
    return compareStrings(a.title, b.title) * orderMultiplier;
  }
  return (aTime - bTime) * orderMultiplier;
}

// ─── Data-loading logic (module-level to keep StagePage clean) ─────────────────

async function loadStageData(
  ctx: RenderPageCtx,
  menuItem: StageMenuItem,
  localePriority: string[],
  isMountedCheck: () => boolean,
): Promise<{
  options: ModelOption[];
  resolvedItemTypes: ResolvedWorkflowItemType[];
  collectedRows: Row[];
}> {
  const client = buildCmaClient(ctx);
  const rawItemTypes = await client.itemTypes.list();
  const itemTypeCollection = Array.isArray(rawItemTypes) ? rawItemTypes : [];

  const mappedItemTypes = itemTypeCollection.map((rawItemType) =>
    mapRawItemType(rawItemType as RawItemTypeRecord),
  );

  const itemTypes = mappedItemTypes.filter(
    (itemType) =>
      itemType.workflowId === menuItem.workflowId && !itemType.modular_block,
  );

  const options = itemTypes
    .map((itemType) => ({ value: itemType.id, label: itemType.name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  if (itemTypes.length === 0) {
    return { options, resolvedItemTypes: [], collectedRows: [] };
  }

  const resolvedItemTypes = await resolveItemTypeFieldKeys(itemTypes, client);

  if (!isMountedCheck()) {
    return { options, resolvedItemTypes, collectedRows: [] };
  }

  const rowGroups = await Promise.all(
    resolvedItemTypes.map((itemType) =>
      collectRowsForItemType(
        client,
        itemType,
        menuItem.stageId,
        localePriority,
        isMountedCheck,
      ),
    ),
  );

  const collectedRows = rowGroups.flat();

  collectedRows.sort((a, b) => {
    const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return bTime - aTime;
  });

  return { options, resolvedItemTypes, collectedRows };
}

// ─── Module-level helpers for component hooks ─────────────────────────────────

function buildLocalePriority(locales: string[]): string[] {
  if (locales.length <= 1) {
    return locales;
  }
  const defaultLocale = locales[0];
  return [
    defaultLocale,
    ...locales.filter((locale) => locale !== defaultLocale),
  ];
}

function filterRowsByQuery(
  rows: Row[],
  selectedModelId: string | null,
  query: string,
): Row[] {
  return rows.filter((row) => {
    const matchesModel = selectedModelId
      ? row.itemTypeId === selectedModelId
      : true;
    if (!matchesModel) {
      return false;
    }
    if (query === '') {
      return true;
    }
    const haystack = `${row.title} ${row.id} ${row.modelName}`.toLowerCase();
    return haystack.includes(query);
  });
}

function resolveEmptyStateMessage(
  rowCount: number,
  filteredCount: number,
  infoMessage: string | null,
  searchTerm: string,
  selectedModelId: string | null,
): string {
  if (rowCount === 0) {
    return infoMessage ?? 'No records found in this stage yet.';
  }
  if (filteredCount === 0) {
    if (searchTerm.trim() !== '') {
      return 'No records match your search.';
    }
    if (selectedModelId) {
      return 'No records match the selected model.';
    }
    return 'No records match your filters.';
  }
  return 'No records available.';
}

function clampPageIndex(pageIndex: number, sortedCount: number): number {
  const totalPages = sortedCount > 0 ? Math.ceil(sortedCount / PAGE_SIZE) : 0;
  if (pageIndex > 0 && pageIndex >= totalPages) {
    return totalPages > 0 ? totalPages - 1 : 0;
  }
  return pageIndex;
}

function computeNextSortState(
  current: { key: SortKey; direction: SortDirection },
  key: SortKey,
): { key: SortKey; direction: SortDirection } {
  if (current.key === key) {
    const nextDirection: SortDirection =
      current.direction === 'asc' ? 'desc' : 'asc';
    return { key, direction: nextDirection };
  }
  const defaultDirection: SortDirection = key === 'updatedAt' ? 'desc' : 'asc';
  return { key, direction: defaultDirection };
}

type DataSetters = {
  setIsLoading: (v: boolean) => void;
  setError: (v: string | null) => void;
  setInfoMessage: (v: string | null) => void;
  setModelOptions: (v: ModelOption[]) => void;
  setRows: (v: Row[]) => void;
  setSelectedModelId: (fn: (prev: string | null) => string | null) => void;
};

async function runLoad(
  ctx: RenderPageCtx,
  menuItem: StageMenuItem | null,
  localePriority: string[],
  isMountedCheck: () => boolean,
  setters: DataSetters,
): Promise<void> {
  if (!menuItem) {
    setters.setError(
      'This page is no longer configured. Please regenerate it from the plugin settings.',
    );
    setters.setIsLoading(false);
    return;
  }

  setters.setIsLoading(true);
  setters.setError(null);
  setters.setInfoMessage(null);

  try {
    const { options, collectedRows } = await loadStageData(
      ctx,
      menuItem,
      localePriority,
      isMountedCheck,
    );

    if (!isMountedCheck()) {
      return;
    }

    applyLoadedData(
      options,
      collectedRows,
      setters.setModelOptions,
      setters.setSelectedModelId,
      setters.setRows,
      setters.setInfoMessage,
    );
  } catch (loadError) {
    if (isMountedCheck()) {
      setters.setError(
        loadError instanceof Error
          ? loadError.message
          : 'Failed to load records.',
      );
    }
  } finally {
    if (isMountedCheck()) {
      setters.setIsLoading(false);
    }
  }
}

function applyLoadedData(
  options: ModelOption[],
  collectedRows: Row[],
  setModelOptions: (v: ModelOption[]) => void,
  setSelectedModelId: (fn: (prev: string | null) => string | null) => void,
  setRows: (v: Row[]) => void,
  setInfoMessage: (v: string | null) => void,
) {
  setModelOptions(options);
  setSelectedModelId((previous) => {
    if (!previous) {
      return null;
    }
    return options.some((option) => option.value === previous)
      ? previous
      : null;
  });
  if (options.length === 0) {
    setRows([]);
    setInfoMessage(
      'No models are linked to this workflow in this environment.',
    );
    return;
  }
  setRows(collectedRows);
  setInfoMessage(
    collectedRows.length === 0
      ? 'No records are currently in this stage.'
      : null,
  );
}

function ariaSort(
  colKey: SortKey,
  sortKey: SortKey,
  direction: SortDirection,
): 'ascending' | 'descending' | 'none' {
  if (colKey !== sortKey) {
    return 'none';
  }
  return direction === 'asc' ? 'ascending' : 'descending';
}

function sortIndicatorClass(
  colKey: SortKey,
  sortKey: SortKey,
  direction: SortDirection,
): string {
  if (colKey !== sortKey) {
    return '';
  }
  return direction === 'asc' ? s.sortAsc : s.sortDesc;
}

type SortableHeaderProps = {
  label: string;
  colKey: SortKey;
  sortKey: SortKey;
  direction: SortDirection;
  onSort: (key: SortKey) => void;
};

function SortableHeader({
  label,
  colKey,
  sortKey,
  direction,
  onSort,
}: SortableHeaderProps) {
  return (
    <th scope="col" aria-sort={ariaSort(colKey, sortKey, direction)}>
      <button
        type="button"
        className={s.sortButton}
        onClick={() => onSort(colKey)}
      >
        <span>{label}</span>
        <span
          className={`${s.sortIndicator} ${sortIndicatorClass(colKey, sortKey, direction)}`}
          aria-hidden="true"
        />
      </button>
    </th>
  );
}

type RecordTableProps = {
  paginatedRows: Row[];
  sortState: { key: SortKey; direction: SortDirection };
  pageIndex: number;
  pageCount: number;
  canGoPrev: boolean;
  canGoNext: boolean;
  sortedRowCount: number;
  onSort: (key: SortKey) => void;
  onNavigate: (itemTypeId: string, itemId: string) => void;
  onRowKeyDown: (
    event: KeyboardEvent<HTMLTableRowElement>,
    itemTypeId: string,
    itemId: string,
  ) => void;
  onPrevPage: () => void;
  onNextPage: () => void;
};

function RecordTable({
  paginatedRows,
  sortState,
  pageIndex,
  pageCount,
  canGoPrev,
  canGoNext,
  sortedRowCount,
  onSort,
  onNavigate,
  onRowKeyDown,
  onPrevPage,
  onNextPage,
}: RecordTableProps) {
  return (
    <div className={s.tableWrapper}>
      <table className={s.table}>
        <thead>
          <tr>
            <SortableHeader
              label="Title"
              colKey="title"
              sortKey={sortState.key}
              direction={sortState.direction}
              onSort={onSort}
            />
            <SortableHeader
              label="Record ID"
              colKey="id"
              sortKey={sortState.key}
              direction={sortState.direction}
              onSort={onSort}
            />
            <SortableHeader
              label="Model"
              colKey="modelName"
              sortKey={sortState.key}
              direction={sortState.direction}
              onSort={onSort}
            />
            <SortableHeader
              label="Updated"
              colKey="updatedAt"
              sortKey={sortState.key}
              direction={sortState.direction}
              onSort={onSort}
            />
          </tr>
        </thead>
        <tbody>
          {paginatedRows.map((row) => (
            <tr
              key={row.id}
              className={s.bodyRow}
              role="link"
              tabIndex={0}
              aria-label={`Open ${row.title}`}
              onClick={() => onNavigate(row.itemTypeId, row.id)}
              onKeyDown={(event) => onRowKeyDown(event, row.itemTypeId, row.id)}
            >
              <td className={s.titleCell}>{row.title}</td>
              <td className={s.recordId}>{row.id}</td>
              <td className={s.modelCell}>{row.modelName}</td>
              <td className={s.timestampCell}>
                {formatTimestamp(row.updatedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={s.paginationBar}>
        <div className={s.paginationInfo}>
          Page {pageCount === 0 ? 0 : pageIndex + 1} of {pageCount}
          {sortedRowCount > 0 ? ` · ${sortedRowCount} records` : ''}
        </div>
        <div className={s.paginationActions}>
          <button
            type="button"
            className={s.pageButton}
            onClick={onPrevPage}
            disabled={!canGoPrev}
          >
            Previous
          </button>
          <button
            type="button"
            className={s.pageButton}
            onClick={onNextPage}
            disabled={!canGoNext}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function StagePage({ ctx, menuItem }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [_reloadIndex] = useState(0);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortState, setSortState] = useState<{
    key: SortKey;
    direction: SortDirection;
  }>({
    key: 'updatedAt',
    direction: 'desc',
  });
  const [pageIndex, setPageIndex] = useState(0);

  const localePriority = useMemo(
    () => buildLocalePriority(ctx.site.attributes.locales ?? []),
    [ctx.site.attributes.locales],
  );

  useEffect(() => {
    let isMounted = true;
    const isMountedCheck = () => isMounted;

    const setters: DataSetters = {
      setIsLoading,
      setError,
      setInfoMessage,
      setModelOptions,
      setRows,
      setSelectedModelId,
    };

    void runLoad(ctx, menuItem, localePriority, isMountedCheck, setters);

    return () => {
      isMounted = false;
    };
  }, [ctx, localePriority, menuItem]);

  const handleNavigate = useCallback(
    (itemTypeId: string, itemId: string) => {
      void ctx.navigateTo(
        `/editor/item_types/${itemTypeId}/items/${itemId}/edit`,
      );
    },
    [ctx],
  );

  const filteredRows = useMemo(
    () =>
      filterRowsByQuery(rows, selectedModelId, searchTerm.trim().toLowerCase()),
    [rows, searchTerm, selectedModelId],
  );

  const sortedRows = useMemo(() => {
    const sorted = [...filteredRows];
    sorted.sort((a, b) =>
      compareRows(a, b, sortState.key, sortState.direction),
    );
    return sorted;
  }, [filteredRows, sortState]);

  const emptyStateMessage = useMemo(
    () =>
      resolveEmptyStateMessage(
        rows.length,
        filteredRows.length,
        infoMessage,
        searchTerm,
        selectedModelId,
      ),
    [
      filteredRows.length,
      infoMessage,
      rows.length,
      searchTerm,
      selectedModelId,
    ],
  );

  useEffect(() => {
    setPageIndex(0);
  }, []);

  useEffect(() => {
    const clamped = clampPageIndex(pageIndex, sortedRows.length);
    if (clamped !== pageIndex) {
      setPageIndex(clamped);
    }
  }, [sortedRows.length, pageIndex]);

  const paginatedRows = useMemo(() => {
    const start = pageIndex * PAGE_SIZE;
    return sortedRows.slice(start, start + PAGE_SIZE);
  }, [pageIndex, sortedRows]);

  const pageCount =
    sortedRows.length > 0 ? Math.ceil(sortedRows.length / PAGE_SIZE) : 0;
  const canGoPrev = pageIndex > 0;
  const canGoNext = pageIndex + 1 < pageCount;

  const handlePrevPage = useCallback(() => {
    setPageIndex((prev) => (prev > 0 ? prev - 1 : 0));
  }, []);

  const handleNextPage = useCallback(() => {
    setPageIndex((prev) => (prev + 1 < pageCount ? prev + 1 : prev));
  }, [pageCount]);

  const handleSearchChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setSearchTerm(event.target.value);
    },
    [],
  );

  const handleClearSearch = useCallback(() => {
    setSearchTerm('');
  }, []);

  const handleModelFilterChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const nextValue = event.target.value.trim();
      setSelectedModelId(nextValue === '' ? null : nextValue);
    },
    [],
  );

  const handleSort = useCallback((key: SortKey) => {
    setSortState((current) => computeNextSortState(current, key));
  }, []);

  const handleRowKeyDown = useCallback(
    (
      event: KeyboardEvent<HTMLTableRowElement>,
      itemTypeId: string,
      itemId: string,
    ) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleNavigate(itemTypeId, itemId);
      }
    },
    [handleNavigate],
  );

  if (!menuItem) {
    return (
      <Canvas ctx={ctx}>
        <Section title="Stage view unavailable" highlighted>
          <p className={s.error}>
            This page no longer matches a saved workflow stage menu item. Please
            remove it from the plugin configuration.
          </p>
        </Section>
      </Canvas>
    );
  }

  return (
    <Canvas ctx={ctx}>
      <section className={s.contentCard}>
        <div className={s.controlsRow}>
          <div className={s.summaryBlock}>
            <p className={s.summaryText}>
              Records belonging to <strong>{menuItem.stageName}</strong> in the{' '}
              <strong>{menuItem.workflowName}</strong> workflow
            </p>
          </div>

          <div className={s.filtersGroup}>
            {modelOptions.length > 0 ? (
              <label className={s.filterField}>
                <span className={s.filterLabel}>Model</span>
                <select
                  className={s.select}
                  value={selectedModelId ?? ''}
                  onChange={handleModelFilterChange}
                >
                  <option value="">All models</option>
                  {modelOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className={s.filterField}>
              <span className={s.filterLabel}>Search</span>
              <div className={s.searchWrapper}>
                <input
                  type="search"
                  className={s.searchInput}
                  value={searchTerm}
                  onChange={handleSearchChange}
                  placeholder="Search titles, IDs, models"
                  aria-label="Search records"
                />
                {searchTerm ? (
                  <button
                    type="button"
                    className={s.clearButton}
                    onClick={handleClearSearch}
                    aria-label="Clear search"
                  >
                    ×
                  </button>
                ) : null}
              </div>
            </label>
          </div>
        </div>

        {error ? <p className={s.error}>{error}</p> : null}

        {isLoading ? (
          <div className={s.loading} role="status" aria-label="Loading records">
            <Spinner
              size={72}
              placement="centered"
              style={{ transform: 'translate(-50%, -50%)' }}
            />
          </div>
        ) : sortedRows.length > 0 ? (
          <RecordTable
            paginatedRows={paginatedRows}
            sortState={sortState}
            pageIndex={pageIndex}
            pageCount={pageCount}
            canGoPrev={canGoPrev}
            canGoNext={canGoNext}
            sortedRowCount={sortedRows.length}
            onSort={handleSort}
            onNavigate={handleNavigate}
            onRowKeyDown={handleRowKeyDown}
            onPrevPage={handlePrevPage}
            onNextPage={handleNextPage}
          />
        ) : (
          <p className={s.empty}>{emptyStateMessage}</p>
        )}
      </section>
    </Canvas>
  );
}
