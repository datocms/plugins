import { ChangeEvent, KeyboardEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Canvas, Section, Spinner } from 'datocms-react-ui';
import { buildCmaClient } from '../utils/cma';
import type { StageMenuItem } from '../types';
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

function extractDisplayValue(value: unknown, locales: string[]): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const extracted = extractDisplayValue(entry, locales);
      if (extracted) {
        return extracted;
      }
    }
    return null;
  }

  if (typeof value === 'object') {
    const recordValue = value as Record<string, unknown>;

    for (const locale of locales) {
      const normalizedCandidates = Array.from(
        new Set([locale, locale.split('-')[0]?.trim()].filter(Boolean)),
      ) as string[];

      for (const candidateLocale of normalizedCandidates) {
        if (candidateLocale in recordValue) {
          const localized = extractDisplayValue(recordValue[candidateLocale], locales);
          if (localized) {
            return localized;
          }
        }
      }
    }

    const priorityKeys = ['title', 'name', 'label', 'value', 'text'];
    for (const key of priorityKeys) {
      if (key in recordValue) {
        const extracted = extractDisplayValue(recordValue[key], locales);
        if (extracted) {
          return extracted;
        }
      }
    }

    for (const entry of Object.values(recordValue)) {
      const extracted = extractDisplayValue(entry, locales);
      if (extracted) {
        return extracted;
      }
    }
  }

  return null;
}

function resolveRecordTitle(
  record: ItemRecord,
  locales: string[],
  preferredPresentationFieldApiKey?: string | null,
  fallbackTitleFieldApiKey?: string | null,
): string {
  const baseAttributes =
    (record as Record<string, unknown>).attributes &&
    typeof (record as Record<string, unknown>).attributes === 'object'
      ? ((record as Record<string, unknown>).attributes as Record<string, unknown>)
      : null;

  const ignoredKeys = baseAttributes
    ? null
    : new Set(['id', 'type', 'meta', 'relationships', 'item_type']);

  const attributeMap =
    baseAttributes ??
    Object.fromEntries(
      Object.entries(record as Record<string, unknown>).filter(([key, value]) => {
        return !(ignoredKeys?.has(key)) && typeof value !== 'function';
      }),
    );

  const preferredKeys = ['title', 'name', 'heading', 'label'];

  if (preferredPresentationFieldApiKey) {
    const candidate = attributeMap[preferredPresentationFieldApiKey];
    const resolved = extractDisplayValue(candidate, locales);
    if (resolved) {
      return resolved;
    }
  }

  if (fallbackTitleFieldApiKey) {
    const candidate = attributeMap[fallbackTitleFieldApiKey];
    const resolved = extractDisplayValue(candidate, locales);
    if (resolved) {
      return resolved;
    }
  }

  for (const key of preferredKeys) {
    const candidate = attributeMap[key];
    const resolved = extractDisplayValue(candidate, locales);
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

function parseUpdatedAt(record: ItemRecord): string | null {
  const metaTimestamp = record.meta?.updated_at;
  if (typeof metaTimestamp === 'string' && metaTimestamp.trim() !== '') {
    return metaTimestamp;
  }

  const attrTimestamp = (record.attributes as Record<string, unknown>)?.updated_at;
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

export default function StagePage({ ctx, menuItem }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [reloadIndex] = useState(0);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortState, setSortState] = useState<{ key: SortKey; direction: SortDirection }>({
    key: 'updatedAt',
    direction: 'desc',
  });
  const [pageIndex, setPageIndex] = useState(0);

  const localePriority = useMemo(() => {
    const locales = ctx.site.attributes.locales ?? [];
    if (locales.length <= 1) {
      return locales;
    }

    const defaultLocale = locales[0];
    return [defaultLocale, ...locales.filter((locale) => locale !== defaultLocale)];
  }, [ctx.site.attributes.locales]);

  useEffect(() => {
    let isMounted = true;

    async function load(): Promise<void> {
      if (!menuItem) {
        setError('This page is no longer configured. Please regenerate it from the plugin settings.');
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);
        setInfoMessage(null);

        const client = buildCmaClient(ctx);
        const rawItemTypes = await client.itemTypes.list();
        const itemTypeCollection = Array.isArray(rawItemTypes) ? rawItemTypes : [];

        const mappedItemTypes: WorkflowItemType[] = (itemTypeCollection as Array<Record<string, any>>).map(
          (itemType) => {
            const workflowRel =
              (itemType.workflow as { id?: string } | null | undefined) ??
              itemType.relationships?.workflow?.data ??
              null;

            const presentationField =
              (itemType.presentation_title_field as { id?: string } | null | undefined) ??
              itemType.relationships?.presentation_title_field?.data ??
              itemType.attributes?.presentation_title_field ??
              null;

            const titleField =
              (itemType.title_field as { id?: string } | null | undefined) ??
              itemType.relationships?.title_field?.data ??
              itemType.attributes?.title_field ??
              null;

            return {
              id: String(itemType.id),
              name: String(itemType.name ?? itemType.attributes?.name ?? itemType.id ?? ''),
              api_key: String(itemType.api_key ?? itemType.attributes?.api_key ?? itemType.id ?? ''),
              modular_block: Boolean(
                typeof itemType.modular_block === 'boolean'
                  ? itemType.modular_block
                  : itemType.attributes?.modular_block,
              ),
              workflowId: workflowRel?.id ?? null,
              presentationTitleFieldId: presentationField?.id ?? null,
              presentationTitleFieldApiKey:
                (presentationField as { api_key?: string } | null | undefined)?.api_key ??
                (presentationField as { attributes?: { api_key?: string } } | null | undefined)?.attributes
                  ?.api_key ??
                null,
              titleFieldId: titleField?.id ?? null,
              titleFieldApiKey:
                (titleField as { api_key?: string } | null | undefined)?.api_key ??
                (titleField as { attributes?: { api_key?: string } } | null | undefined)?.attributes?.api_key ??
                null,
            };
          },
        );

        const itemTypes = mappedItemTypes.filter(
          (itemType) => itemType.workflowId === menuItem.workflowId && !itemType.modular_block,
        );

        if (!isMounted) {
          return;
        }

        const options = itemTypes
          .map((itemType) => ({ value: itemType.id, label: itemType.name }))
          .sort((a, b) => a.label.localeCompare(b.label));

        setModelOptions(options);
        setSelectedModelId((previous) => {
          if (!previous) {
            return null;
          }

          return options.some((option) => option.value === previous) ? previous : null;
        });

        if (itemTypes.length === 0) {
          setRows([]);
          setInfoMessage('No models are linked to this workflow in this environment.');
          return;
        }

        const fieldApiKeyCache = new Map<string, string | null>();
        const resolvedItemTypes: ResolvedWorkflowItemType[] = [];

        for (const itemType of itemTypes) {
          if (!isMounted) {
            return;
          }

          let presentationTitleFieldApiKey: string | null = itemType.presentationTitleFieldApiKey ?? null;
          const presentationFieldId = itemType.presentationTitleFieldId;

          if (!presentationTitleFieldApiKey && presentationFieldId) {
            if (fieldApiKeyCache.has(presentationFieldId)) {
              presentationTitleFieldApiKey = fieldApiKeyCache.get(presentationFieldId) ?? null;
            } else {
              try {
                const field = await client.fields.find(presentationFieldId);
                const fieldRecord = field as
                  | { api_key?: string; attributes?: { api_key?: string } }
                  | undefined
                  | null;
                const apiKey = fieldRecord?.api_key ?? fieldRecord?.attributes?.api_key ?? null;
                fieldApiKeyCache.set(presentationFieldId, apiKey);
                presentationTitleFieldApiKey = apiKey;
              } catch (lookupError) {
                fieldApiKeyCache.set(presentationFieldId, null);
              }
            }
          }

          let titleFieldApiKey: string | null = itemType.titleFieldApiKey ?? null;
          const titleFieldId = itemType.titleFieldId;

          if (!titleFieldApiKey && titleFieldId) {
            if (fieldApiKeyCache.has(titleFieldId)) {
              titleFieldApiKey = fieldApiKeyCache.get(titleFieldId) ?? null;
            } else {
              try {
                const field = await client.fields.find(titleFieldId);
                const fieldRecord = field as
                  | { api_key?: string; attributes?: { api_key?: string } }
                  | undefined
                  | null;
                const apiKey = fieldRecord?.api_key ?? fieldRecord?.attributes?.api_key ?? null;
                fieldApiKeyCache.set(titleFieldId, apiKey);
                titleFieldApiKey = apiKey;
              } catch (lookupError) {
                fieldApiKeyCache.set(titleFieldId, null);
              }
            }
          }

          resolvedItemTypes.push({
            ...itemType,
            presentationTitleFieldApiKey,
            titleFieldApiKey,
          });
        }

        if (!isMounted) {
          return;
        }

        const collectedRows: Row[] = [];

        await Promise.all(
          resolvedItemTypes.map(async (itemType) => {
            const iterator = client.items.listPagedIterator({
              filter: { type: itemType.id },
              version: 'current',
              nested: true,
              locale: localePriority[0],
            });

            for await (const record of iterator) {
              if (!isMounted) {
                break;
              }

              const typedRecord = record as unknown as ItemRecord;

              if (typedRecord.meta?.stage !== menuItem.stageId) {
                continue;
              }

              const title = resolveRecordTitle(
                typedRecord,
                localePriority,
                itemType.presentationTitleFieldApiKey,
                itemType.titleFieldApiKey,
              );

              collectedRows.push({
                id: typedRecord.id,
                itemTypeId: itemType.id,
                modelName: itemType.name,
                title,
                updatedAt: parseUpdatedAt(typedRecord),
              });

            }
          }),
        );

        if (!isMounted) {
          return;
        }

        collectedRows.sort((a, b) => {
          const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
          const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
          return bTime - aTime;
        });

        setRows(collectedRows);
        setInfoMessage(
          collectedRows.length === 0
            ? 'No records are currently in this stage.'
            : null,
        );
      } catch (loadError) {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load records.');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void load();

    return () => {
      isMounted = false;
    };
  }, [ctx, localePriority, menuItem, reloadIndex]);

  const handleNavigate = useCallback(
    (itemTypeId: string, itemId: string) => {
      void ctx.navigateTo(`/editor/item_types/${itemTypeId}/items/${itemId}/edit`);
    },
    [ctx],
  );

  const filteredRows = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    return rows.filter((row) => {
      const matchesModel = selectedModelId ? row.itemTypeId === selectedModelId : true;
      if (!matchesModel) {
        return false;
      }

      if (query === '') {
        return true;
      }

      const haystack = `${row.title} ${row.id} ${row.modelName}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [rows, searchTerm, selectedModelId]);

  const sortedRows = useMemo(() => {
    const sorted = [...filteredRows];

    const compareStrings = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

    sorted.sort((a, b) => {
      const orderMultiplier = sortState.direction === 'asc' ? 1 : -1;

      switch (sortState.key) {
        case 'title':
          return compareStrings(a.title, b.title) * orderMultiplier;
        case 'id':
          return compareStrings(a.id, b.id) * orderMultiplier;
        case 'modelName':
          return compareStrings(a.modelName, b.modelName) * orderMultiplier;
        case 'updatedAt': {
          const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
          const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
          if (aTime === bTime) {
            return compareStrings(a.title, b.title) * orderMultiplier;
          }
          return (aTime - bTime) * orderMultiplier;
        }
        default:
          return 0;
      }
    });

    return sorted;
  }, [filteredRows, sortState]);

  const emptyStateMessage = useMemo(() => {
    if (rows.length === 0) {
      return infoMessage ?? 'No records found in this stage yet.';
    }

    if (filteredRows.length === 0) {
      if (searchTerm.trim() !== '') {
        return 'No records match your search.';
      }
      if (selectedModelId) {
        return 'No records match the selected model.';
      }
      return 'No records match your filters.';
    }

    return 'No records available.';
  }, [filteredRows.length, infoMessage, rows.length, searchTerm, selectedModelId]);

  useEffect(() => {
    setPageIndex(0);
  }, [selectedModelId, searchTerm, rows.length]);

  useEffect(() => {
    const totalPages = sortedRows.length > 0 ? Math.ceil(sortedRows.length / PAGE_SIZE) : 0;
    if (pageIndex > 0 && pageIndex >= totalPages) {
      setPageIndex(totalPages > 0 ? totalPages - 1 : 0);
    }
  }, [sortedRows, pageIndex]);

  const paginatedRows = useMemo(() => {
    const start = pageIndex * PAGE_SIZE;
    return sortedRows.slice(start, start + PAGE_SIZE);
  }, [pageIndex, sortedRows]);

  const pageCount = sortedRows.length > 0 ? Math.ceil(sortedRows.length / PAGE_SIZE) : 0;
  const canGoPrev = pageIndex > 0;
  const canGoNext = pageIndex + 1 < pageCount;

  const handlePrevPage = useCallback(() => {
    setPageIndex((prev) => (prev > 0 ? prev - 1 : 0));
  }, []);

  const handleNextPage = useCallback(() => {
    setPageIndex((prev) => (prev + 1 < pageCount ? prev + 1 : prev));
  }, [pageCount]);

  const handleSearchChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(event.target.value);
  }, []);

  const handleClearSearch = useCallback(() => {
    setSearchTerm('');
  }, []);

  const handleModelFilterChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    const nextValue = event.target.value.trim();
    setSelectedModelId(nextValue === '' ? null : nextValue);
  }, []);

  const handleSort = useCallback((key: SortKey) => {
    setSortState((current) => {
      if (current.key === key) {
        const nextDirection: SortDirection = current.direction === 'asc' ? 'desc' : 'asc';
        return { key, direction: nextDirection };
      }

      const defaultDirection: SortDirection = key === 'updatedAt' ? 'desc' : 'asc';
      return { key, direction: defaultDirection };
    });
  }, []);

  const handleRowKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTableRowElement>, itemTypeId: string, itemId: string) => {
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
            This page no longer matches a saved workflow stage menu item. Please remove it from the plugin
            configuration.
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
                <select className={s.select} value={selectedModelId ?? ''} onChange={handleModelFilterChange}>
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
                  <button type="button" className={s.clearButton} onClick={handleClearSearch} aria-label="Clear search">
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
            <Spinner size={72} placement="centered" style={{ transform: 'translate(-50%, -50%)' }} />
          </div>
        ) : sortedRows.length > 0 ? (
          <div className={s.tableWrapper}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th
                    scope="col"
                    aria-sort={
                      sortState.key === 'title'
                        ? sortState.direction === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                  >
                    <button type="button" className={s.sortButton} onClick={() => handleSort('title')}>
                      <span>Title</span>
                      <span
                        className={`${s.sortIndicator} ${
                          sortState.key === 'title'
                            ? sortState.direction === 'asc'
                              ? s.sortAsc
                              : s.sortDesc
                            : ''
                        }`}
                        aria-hidden="true"
                      />
                    </button>
                  </th>
                  <th
                    scope="col"
                    aria-sort={
                      sortState.key === 'id'
                        ? sortState.direction === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                  >
                    <button type="button" className={s.sortButton} onClick={() => handleSort('id')}>
                      <span>Record ID</span>
                      <span
                        className={`${s.sortIndicator} ${
                          sortState.key === 'id'
                            ? sortState.direction === 'asc'
                              ? s.sortAsc
                              : s.sortDesc
                            : ''
                        }`}
                        aria-hidden="true"
                      />
                    </button>
                  </th>
                  <th
                    scope="col"
                    aria-sort={
                      sortState.key === 'modelName'
                        ? sortState.direction === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                  >
                    <button type="button" className={s.sortButton} onClick={() => handleSort('modelName')}>
                      <span>Model</span>
                      <span
                        className={`${s.sortIndicator} ${
                          sortState.key === 'modelName'
                            ? sortState.direction === 'asc'
                              ? s.sortAsc
                              : s.sortDesc
                            : ''
                        }`}
                        aria-hidden="true"
                      />
                    </button>
                  </th>
                  <th
                    scope="col"
                    aria-sort={
                      sortState.key === 'updatedAt'
                        ? sortState.direction === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                  >
                    <button type="button" className={s.sortButton} onClick={() => handleSort('updatedAt')}>
                      <span>Updated</span>
                      <span
                        className={`${s.sortIndicator} ${
                          sortState.key === 'updatedAt'
                            ? sortState.direction === 'asc'
                              ? s.sortAsc
                              : s.sortDesc
                            : ''
                        }`}
                        aria-hidden="true"
                      />
                    </button>
                  </th>
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
                    onClick={() => handleNavigate(row.itemTypeId, row.id)}
                    onKeyDown={(event) => handleRowKeyDown(event, row.itemTypeId, row.id)}
                  >
                    <td className={s.titleCell}>{row.title}</td>
                    <td className={s.recordId}>{row.id}</td>
                    <td className={s.modelCell}>{row.modelName}</td>
                    <td className={s.timestampCell}>{formatTimestamp(row.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className={s.paginationBar}>
              <div className={s.paginationInfo}>
                Page {pageCount === 0 ? 0 : pageIndex + 1} of {pageCount}
                {sortedRows.length > 0 ? ` · ${sortedRows.length} records` : ''}
              </div>
              <div className={s.paginationActions}>
                <button
                  type="button"
                  className={s.pageButton}
                  onClick={handlePrevPage}
                  disabled={!canGoPrev}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className={s.pageButton}
                  onClick={handleNextPage}
                  disabled={!canGoNext}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        ) : (
          <p className={s.empty}>{emptyStateMessage}</p>
        )}
      </section>
    </Canvas>
  );
}
