import type { Client } from '@datocms/cma-client-browser';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import Canvas from 'datocms-react-ui/Canvas';
import ListArea from 'datocms-react-ui/ListArea';
import { getPaginatedListState } from 'datocms-react-ui/ListDetail';
import Main from 'datocms-react-ui/Main';
import MultipleSelectionActionBar, {
  type Action,
  type MaybeAction,
} from 'datocms-react-ui/MultipleSelectionActionBar';
import Pane from 'datocms-react-ui/Pane';
import Toolbar, { useFilterToolbar } from 'datocms-react-ui/Toolbar';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AllRecordsTable } from '../components/AllRecordsTable';
import { columnSettingsStorageKey } from '../components/columnSettings';
import { FilterDropdown } from '../components/FilterDropdown';
import { MoveToStageMenu } from '../components/MoveToStageMenu';
import type { TableRecord } from '../components/types';
import { useColumnSettings } from '../components/useColumnSettings';
import { MAX_BULK_ITEMS, PER_PAGE_OPTIONS } from '../constants';
import { buildCmaClient } from '../data/cma';
import { collectSelection } from '../data/collectSelection';
import { loadItemsById, loadUploadsById, mapBounded } from '../data/loadById';
import { getRegularModels } from '../data/models';
import {
  previewOrderingField,
  serverOrderBy,
  sortableColumnIds,
} from '../data/ordering';
import { DEFAULT_ORDER_BY, throwIfItemsRequestAborted } from '../data/query';
import { CircleExclamationIcon, RefreshIcon, TableListIcon } from '../icons';
import {
  availableMoveDestinationIds,
  evaluateMoveSelection,
  evaluateSelection,
  getMoveSelectionContext,
} from '../operations/candidates';
import { executeBulkOperation } from '../operations/execute';
import { identityKey } from '../operations/permissions';
import { bulkErrorMessage, bulkResultMessage } from '../operations/results';
import type {
  BulkOperationProgress,
  BulkOperationResult,
  SelectionAction as BulkSelectionAction,
  MoveSelectionContext,
  PermissionContext,
  SelectionEvaluation,
  SelectionInput,
} from '../operations/types';
import type { RawField } from '../presentation/fields';
import { createPresentationResolver } from '../presentation/resolver';
import {
  getItemStatus,
  getItemValidity,
  ITEM_STATUS_LABEL,
} from '../presentation/status';
import { buildRecordEditorUrl } from '../state/navigation';
import {
  buildPluginPageUrl,
  clampPage,
  parseQueryState,
  updateQueryState,
} from '../state/queryState';
import {
  compactSelectedItem,
  invertPageSelection,
  retainSelectionForModels,
  setPageSelection,
} from '../state/selection';
import { useDebouncedValue } from '../state/useDebouncedValue';
import { useItemsPage } from '../state/useItemsPage';
import { useModelFields } from '../state/useModelFields';
import { usePresentations } from '../state/usePresentations';
import { useSelectedItemsPage } from '../state/useSelectedItemsPage';
import { TEXTS } from '../texts';
import type {
  ModelSummary,
  QueryState,
  RawItem,
  RawItemType,
  WorkflowStageOption,
} from '../types';
import s from './AllRecordsPage.module.css';

type Props = {
  ctx: RenderPageCtx;
};

/** The bulk action that runs now, if any */
type BusyAction = BulkSelectionAction | 'move';

const STATUS_FILTER_OPTIONS = [
  { label: 'All statuses', value: '' },
  { label: 'Draft', value: 'draft' },
  { label: 'Unpublished changes', value: 'updated' },
  { label: 'Published', value: 'published' },
] as const;

const PER_PAGE_SELECT_OPTIONS = [...PER_PAGE_OPTIONS];

const ACTION_RUNNING = { reason: 'Wait for the current action to finish.' };
const RECORDS_LOADING = { reason: 'Wait for the records to load.' };

function ignore(): void {}

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function isoDate(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function operationLabel(action: BulkSelectionAction): string {
  switch (action) {
    case 'delete':
      return 'Delete';
    case 'publish':
      return 'Publish';
    case 'unpublish':
      return 'Unpublish';
  }
}

function confirmationContent(
  action: BulkSelectionAction | 'move_to_stage',
  evaluation: SelectionEvaluation,
): string {
  const eligible = `${evaluation.eligibleCount} ${
    evaluation.eligibleCount === 1 ? 'record' : 'records'
  }`;
  const scope =
    evaluation.excludedCount > 0
      ? `${eligible} of ${evaluation.selectedCount} selected records are eligible.`
      : `${eligible} will be affected.`;

  if (action === 'delete') {
    return `${scope} This action cannot be undone.`;
  }

  return scope;
}

function rawItemTypes(itemTypes: RenderPageCtx['itemTypes']): RawItemType[] {
  return Object.values(itemTypes).filter(isDefined) as RawItemType[];
}

function modelMap(
  models: readonly ModelSummary[],
): ReadonlyMap<string, ModelSummary> {
  return new Map(models.map((model) => [model.id, model]));
}

function creatorRoleMap(
  users: RenderPageCtx['users'],
  ssoUsers: RenderPageCtx['ssoUsers'],
  owner: RenderPageCtx['owner'],
): ReadonlyMap<string, string | null> {
  const result = new Map<string, string | null>();

  for (const user of Object.values(users ?? {}).filter(isDefined)) {
    result.set(identityKey(user), user.relationships.role.data.id);
  }

  for (const user of Object.values(ssoUsers ?? {}).filter(isDefined)) {
    result.set(identityKey(user), user.relationships.role.data?.id ?? null);
  }

  if (owner) {
    result.set(identityKey(owner), null);
  }

  return result;
}

// A number with the separators of the locale of the user ("1,234"), as the
// `#` of the ICU texts of Canvas
function formatNumber(locale: string, value: number): string {
  return new Intl.NumberFormat(locale).format(value);
}

// The count of the title bar ("1,234 records"), with the separators and the
// plural rules of the locale of the user, as the ICU texts of Canvas do
function formatRecordCount(locale: string, count: number): string {
  const number = formatNumber(locale, count);
  return new Intl.PluralRules(locale).select(count) === 'one'
    ? `${number} record`
    : `${number} records`;
}

function displayedOrderBy(queryState: QueryState) {
  return queryState.query ? null : (queryState.orderBy ?? DEFAULT_ORDER_BY);
}

function useOrderingState(args: {
  itemTypes: readonly RawItemType[];
  modelId: string | null;
  status: QueryState['status'];
  orderBy: QueryState['orderBy'];
  loadItemTypeFields: RenderPageCtx['loadItemTypeFields'];
  onUnsupportedPreviewOrder: () => void;
}) {
  const selectedItemType = useMemo(
    () =>
      args.modelId
        ? (args.itemTypes.find((itemType) => itemType.id === args.modelId) ??
          null)
        : null,
    [args.itemTypes, args.modelId],
  );
  const loadOrderingFields = useCallback(
    async (modelId: string): Promise<readonly RawField[]> =>
      (await args.loadItemTypeFields(modelId)) as RawField[],
    [args.loadItemTypeFields],
  );
  const modelFieldsState = useModelFields(
    selectedItemType?.id ?? null,
    loadOrderingFields,
  );
  const fields =
    modelFieldsState.modelId === selectedItemType?.id
      ? modelFieldsState.fields
      : [];
  const fieldsLoaded =
    selectedItemType === null ||
    (modelFieldsState.modelId === selectedItemType.id &&
      modelFieldsState.loaded);
  const requestedOrderBy = args.orderBy ?? DEFAULT_ORDER_BY;
  const resolvedServerOrderBy = useMemo(
    () =>
      serverOrderBy({
        orderBy: requestedOrderBy,
        itemType: selectedItemType,
        fields,
      }),
    [fields, requestedOrderBy, selectedItemType],
  );
  const columnIds = useMemo(() => {
    const result = new Set(
      sortableColumnIds({
        itemType: selectedItemType,
        fields,
        fieldsLoaded,
      }),
    );
    if (args.status) {
      result.delete('_status');
    }
    return result;
  }, [args.status, fields, fieldsLoaded, selectedItemType]);

  useEffect(() => {
    if (
      args.orderBy?.startsWith('_preview_') &&
      selectedItemType &&
      fieldsLoaded &&
      previewOrderingField(selectedItemType, fields) === null
    ) {
      args.onUnsupportedPreviewOrder();
    }
  }, [
    args.onUnsupportedPreviewOrder,
    args.orderBy,
    fields,
    fieldsLoaded,
    selectedItemType,
  ]);

  return {
    columnIds,
    pending:
      args.orderBy?.startsWith('_preview_') === true &&
      selectedItemType !== null &&
      !fieldsLoaded,
    serverOrderBy: resolvedServerOrderBy,
  };
}

type SelectionBarActionId =
  | BusyAction
  | 'selectAllMatching'
  | 'toggleSelection'
  | 'invert';

/** The "Move to stage" action: a menu of stages, or a reason why not */
type MoveBarAction = { menu: ReactNode } | { disabledReason: string };

// The buttons of the selection bar. The plain actions change the selection;
// the main actions on it are primary, with Delete last. An action that does
// not apply to any selected record does not show. While an action runs, its
// own button shows a spinner and the others say why they wait.
function buildSelectionBarActions(args: {
  running: SelectionBarActionId | null;
  loading: boolean;
  showingSelected: boolean;
  /** The number of matching records, when the bar offers to select them */
  selectAllMatchingCount: number | null;
  evaluations: Record<BulkSelectionAction, SelectionEvaluation>;
  move: MoveBarAction | null;
  onSelectAllMatching: () => void | Promise<void>;
  onToggleSelection: () => void;
  onInvertSelection: () => void;
  onRun: (action: BulkSelectionAction) => void | Promise<void>;
}): (MaybeAction | MaybeAction[])[] {
  const waitReason = args.running
    ? ACTION_RUNNING
    : args.loading
      ? RECORDS_LOADING
      : undefined;
  const disabled = (id: SelectionBarActionId) =>
    args.running === id ? undefined : waitReason;
  const mainAction = (
    action: BulkSelectionAction,
    label: string,
  ): MaybeAction =>
    args.evaluations[action].eligibleCount > 0 && {
      id: action,
      tone: 'primary',
      label,
      disabled: disabled(action),
      onClick: () => args.onRun(action),
    };
  const move: Action | null = args.move && {
    id: 'move',
    tone: 'primary',
    label: 'Move to stage',
    ...('menu' in args.move
      ? // The menu shows no spinner of its own: it waits like the others
        { disabled: waitReason, menu: args.move.menu }
      : { disabled: { reason: args.move.disabledReason }, menu: null }),
  };

  return [
    [
      args.selectAllMatchingCount !== null && {
        id: 'selectAllMatching',
        label: {
          id: 'allRecords.selectAllMatching',
          values: { count: args.selectAllMatchingCount },
        },
        disabled: disabled('selectAllMatching'),
        onClick: args.onSelectAllMatching,
      },
      {
        id: 'toggleSelection',
        label: args.showingSelected ? 'Hide selection' : 'Show selection',
        disabled: disabled('toggleSelection'),
        onClick: args.onToggleSelection,
      },
      {
        id: 'invert',
        label: 'Invert selection',
        disabled: disabled('invert'),
        onClick: args.onInvertSelection,
      },
    ],
    mainAction('publish', 'Publish'),
    mainAction('unpublish', 'Unpublish'),
    move,
    mainAction('delete', 'Delete'),
  ];
}

function bulkProgressText(
  locale: string,
  progress: BulkOperationProgress,
): string {
  const n = (value: number) => formatNumber(locale, value);
  return `${n(progress.completed)} of ${n(progress.requested)} processed; ${n(progress.successful)} succeeded; ${n(progress.failed)} failed`;
}

function collectionProgressText(
  locale: string,
  count: number,
  total: number,
): string {
  return `Selecting ${formatNumber(locale, count)} of ${formatNumber(locale, total)} records…`;
}

function reportBulkResult(
  ctx: RenderPageCtx,
  result: BulkOperationResult,
): void {
  const message = bulkResultMessage(result);
  if (result.failed > 0 || result.unprocessed) {
    ctx.alert(message);
  } else {
    ctx.notice(message);
  }
}

async function confirmSelectionAction(
  ctx: RenderPageCtx,
  action: BulkSelectionAction,
  evaluation: SelectionEvaluation,
): Promise<boolean> {
  const label = operationLabel(action);
  return Boolean(
    await ctx.openConfirm({
      title: `${label} selected records`,
      content: confirmationContent(action, evaluation),
      choices: [
        {
          label,
          value: true,
          intent: action === 'delete' ? 'negative' : 'positive',
        },
      ],
      cancel: { label: 'Cancel', value: false },
    }),
  );
}

async function confirmMoveToStage(
  ctx: RenderPageCtx,
  destination: WorkflowStageOption,
  evaluation: SelectionEvaluation,
): Promise<boolean> {
  return Boolean(
    await ctx.openConfirm({
      title: `Move selected records to ${destination.name}`,
      content: `${confirmationContent('move_to_stage', evaluation)} Destination: ${destination.name}.`,
      choices: [{ label: 'Move to stage', value: true, intent: 'positive' }],
      cancel: { label: 'Cancel', value: false },
    }),
  );
}

// Why the filters do nothing now, if they do nothing
function disabledFiltersReason(args: {
  actionRunning: boolean;
  orderingPending: boolean;
}): { reason: string } | undefined {
  if (args.actionRunning) return ACTION_RUNNING;
  if (args.orderingPending) return RECORDS_LOADING;
  return undefined;
}

function displayPage<T>(showingSelected: boolean, selected: T, page: T): T {
  return showingSelected ? selected : page;
}

function synchronizeSelection(
  selected: ReadonlyMap<string, RawItem>,
  currentItems: readonly RawItem[],
): ReadonlyMap<string, RawItem> {
  let next: Map<string, RawItem> | undefined;
  for (const item of currentItems) {
    const previous = selected.get(item.id);
    if (!previous) continue;
    const current = compactSelectedItem(item);
    if (
      JSON.stringify(previous.meta) === JSON.stringify(current.meta) &&
      JSON.stringify(previous.relationships) ===
        JSON.stringify(current.relationships)
    ) {
      continue;
    }
    next ??= new Map(selected);
    next.set(item.id, current);
  }
  return next ?? selected;
}

async function loadCurrentSelection(
  client: Client,
  selected: readonly RawItem[],
  {
    omitMissing = false,
    signal,
  }: { omitMissing?: boolean; signal?: AbortSignal } = {},
): Promise<RawItem[]> {
  const batches: string[][] = [];
  for (let offset = 0; offset < selected.length; offset += 100) {
    batches.push(selected.slice(offset, offset + 100).map((item) => item.id));
  }
  const loaded = (
    await mapBounded(batches, async (ids) => {
      throwIfItemsRequestAborted(signal);
      const items = await loadItemsById(client, ids);
      throwIfItemsRequestAborted(signal);
      // Discard large fields per batch rather than aggregating full records.
      return items.map(compactSelectedItem);
    })
  ).flat();
  const byId = new Map(loaded.map((item) => [item.id, item]));
  const missingMessage =
    'Some selected records no longer exist or cannot be read. Refresh the view and select the records again.';
  const selectedIds = new Set(selected.map((item) => item.id));
  if (
    [...byId.keys()].some((id) => !selectedIds.has(id)) ||
    (!omitMissing && byId.size !== selected.length)
  ) {
    throw new Error(missingMessage);
  }
  return selected.flatMap((item) => {
    const current = byId.get(item.id);
    if (!current && omitMissing) return [];
    if (!current) throw new Error(missingMessage);
    return [current];
  });
}

type MoveCheck =
  | { evaluation: SelectionEvaluation }
  /** `refresh` reloads the list after the alert, as for a failed action */
  | { message: string; refresh: boolean };

// The menu showed the stages of the selection before its reload: check the
// pick again against the current records.
function checkMoveDestination(args: {
  selection: SelectionInput;
  destination: WorkflowStageOption;
  workflowId: string;
  workflowStageIds: readonly string[];
}): MoveCheck {
  const moveContext = getMoveSelectionContext(args.selection);
  if (!moveContext.enabled) {
    return { message: moveContext.disabledReason, refresh: true };
  }
  const unavailable = {
    message: 'The selected workflow stage is no longer available.',
    refresh: false,
  };
  if (moveContext.workflowId !== args.workflowId) return unavailable;
  const availableIds = availableMoveDestinationIds({
    ...args.selection,
    destinationStageIds: args.workflowStageIds,
  });
  if (availableIds.length === 0) {
    return {
      message: 'None of the selected records can be moved to another stage.',
      refresh: false,
    };
  }
  if (!availableIds.includes(args.destination.id)) return unavailable;
  const evaluation = evaluateMoveSelection({
    ...args.selection,
    destinationStageId: args.destination.id,
  });
  return evaluation.disabledReason
    ? { message: evaluation.disabledReason, refresh: false }
    : { evaluation };
}

/** The last loaded page of the list: its total, and the filters it is of */
type LoadedResult = {
  totalCount: number;
  /** The filters of the load (JSON of model, status and query) */
  filterScope: string;
};

// The last loaded page of the list: undefined until the first load ends, then
// kept while the list loads again (useItemsPage forgets it while a Preview
// order waits for the fields of the model). useItemsPage keeps the object of
// a loaded page until the next load starts, thus the filters of the render
// that first sees an object are the filters it was loaded for. The renders
// between a change of the filters and the start of the new load see the old
// object, and keep the filters of the old load.
function useLoadedResult(
  itemsPage: { loaded: boolean; totalCount: number },
  filterScope: string,
): LoadedResult | undefined {
  const [last, setLast] = useState<{
    page: object;
    result: LoadedResult;
  }>();
  if (itemsPage.loaded && last?.page !== itemsPage) {
    const result = { totalCount: itemsPage.totalCount, filterScope };
    setLast({ page: itemsPage, result });
    return result;
  }
  return last?.result;
}

const NO_ITEMS: readonly RawItem[] = [];

// The rows of "Show selection". useSelectedItemsPage empties its rows each
// time it loads them again (another page of the selection, a record that
// leaves the selection, a refresh): meanwhile the table keeps the rows of the
// last load, less the records that are no longer selected, as the list keeps
// its last page. Before the first load of the selection there are none, thus
// the area shows its loading state.
function useSelectionRows(args: {
  page: { items: readonly RawItem[]; loading: boolean; error: string | null };
  loadStarted: boolean;
  selectedById: ReadonlyMap<string, RawItem>;
}): readonly RawItem[] {
  const { page, loadStarted, selectedById } = args;
  const [lastRows, setLastRows] = useState<readonly RawItem[]>(NO_ITEMS);
  useEffect(() => {
    if (!loadStarted) {
      setLastRows(NO_ITEMS);
    } else if (!page.loading && !page.error) {
      setLastRows(page.items);
    }
  }, [loadStarted, page.items, page.loading, page.error]);
  const keptRows = useMemo(() => {
    const kept = lastRows.filter((item) => selectedById.has(item.id));
    // The same array while no row left: the presentations stay as they are
    return kept.length === lastRows.length ? lastRows : kept;
  }, [lastRows, selectedById]);
  return loadStarted && page.loading ? keptRows : page.items;
}

type PageState =
  | 'no-token'
  | 'no-models'
  | 'loading'
  | 'empty'
  | 'no-results'
  | 'ready'
  | 'failed';

function pageStateOf(args: {
  hasToken: boolean;
  hasModels: boolean;
  failed: boolean;
  showingSelected: boolean;
  loaded: LoadedResult | undefined;
  filterScope: string;
  queryState: QueryState;
}): PageState {
  if (!args.hasToken) return 'no-token';
  if (!args.hasModels) return 'no-models';
  if (args.failed) return 'failed';
  // "Show selection" lists the selected records, which are never empty. A
  // page of them that can't be loaded is a state of the list area.
  if (args.showingSelected) return 'ready';
  // The list loads for other filters: the last page tells nothing about them,
  // thus the title bar stays and the list shows its loading state (or the
  // last rows) until the new page arrives
  if (args.loaded && args.loaded.filterScope !== args.filterScope) {
    return 'ready';
  }
  return getPaginatedListState(
    args.loaded === undefined ? undefined : args.loaded.totalCount === 0,
    Boolean(
      args.queryState.query || args.queryState.model || args.queryState.status,
    ),
  );
}

// The states that are the whole page, with no title bar
function PageBlankSlate({ state }: { state: PageState }) {
  switch (state) {
    case 'no-token':
      return (
        <BlankSlate
          placement="area"
          titleLevel={1}
          error
          icon={<CircleExclamationIcon />}
          title="No access to your API token"
          description="This page needs the “Current user access token” permission. Turn it on in the plugin settings, then reload the page."
        />
      );
    case 'no-models':
      return (
        <BlankSlate
          placement="area"
          titleLevel={1}
          icon={<TableListIcon />}
          title="All records"
          description="This environment has no models yet. The records of every model show here."
        />
      );
    case 'empty':
      return (
        <BlankSlate
          placement="area"
          titleLevel={1}
          icon={<TableListIcon />}
          title="All records"
          description="There are no records to show yet. The records of every model that you can read show here."
        />
      );
    default:
      return (
        <BlankSlate placement="area" loading title="Loading the records" />
      );
  }
}

// What the area of the list shows: the error of the last load, the "no
// results" of the filters, the spinner while a page has no rows yet, a page
// of the selection whose records can't be shown, or the table (with the
// relevance notice while searching)
function RecordsArea({
  state,
  error,
  waitingForRows,
  selectionUnavailable,
  searching,
  onRetry,
  children,
}: {
  state: PageState;
  error: string | null;
  waitingForRows: boolean;
  selectionUnavailable: boolean;
  searching: boolean;
  onRetry: () => void;
  children: ReactNode;
}) {
  if (state === 'failed') {
    return (
      <BlankSlate
        placement="area"
        error
        icon={<CircleExclamationIcon />}
        title="Couldn't load the records"
        code={error ?? undefined}
        description="Check your connection, then try again."
        actions={
          <Button icon={RefreshIcon} label="Try again" onClick={onRetry} />
        }
      />
    );
  }
  if (state === 'no-results') {
    return <Pane.FilterBlankSlate />;
  }
  if (waitingForRows) {
    return <BlankSlate placement="area" loading title="Loading the records" />;
  }
  // The selection bar stays: the user can hide the selection or clear it
  if (selectionUnavailable) {
    return (
      <BlankSlate
        placement="area"
        icon={<TableListIcon />}
        title="The selected records can't be shown"
        description="They were deleted, or you can no longer read them."
      />
    );
  }
  return (
    <>
      {searching && (
        <Callout>
          While you search, the records are sorted by relevance.
        </Callout>
      )}
      {children}
    </>
  );
}

type FilterOption = { label: string; value: string };

// The title bar, and the search row under it while the filter is open
function RecordsTitleBar({
  count,
  locale,
  busy,
  modelOptions,
  queryState,
  filtersDisabled,
  searchLocked,
  search,
  onSearchChange,
  filter,
  onFilter,
}: {
  /** The number of listed records, once the first load ends */
  count: number | null;
  locale: string;
  busy: boolean;
  modelOptions: readonly FilterOption[];
  queryState: QueryState;
  filtersDisabled: { reason: string } | undefined;
  searchLocked: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  filter: ReturnType<typeof useFilterToolbar>;
  onFilter: (patch: Partial<QueryState>) => void;
}) {
  return (
    <>
      <Toolbar>
        <Toolbar.Title
          level={1}
          help={
            <Toolbar.Help>
              Every record of this environment, from all its models, in one
              table. Select records to publish, unpublish, delete or move them
              to a workflow stage.
            </Toolbar.Help>
          }
        >
          All records
        </Toolbar.Title>
        <Toolbar.Subtitle hidden={count === null}>
          {count !== null && formatRecordCount(locale, count)}
        </Toolbar.Subtitle>
        <Toolbar.Spinner show={busy} />
        <Toolbar.Space />
        <Toolbar.Group>
          <FilterDropdown
            tooltip="Filter by model"
            value={queryState.model ?? ''}
            options={modelOptions}
            disabled={filtersDisabled}
            onChange={(value) => onFilter({ model: value || null })}
          />
          <FilterDropdown
            tooltip="Filter by status"
            value={queryState.status ?? ''}
            options={STATUS_FILTER_OPTIONS}
            disabled={filtersDisabled}
            onChange={(value) =>
              onFilter({ status: (value as QueryState['status']) || null })
            }
          />
          <Toolbar.FilterToggle
            pressed={filter.open}
            // Closing the filter clears the search: not while it is locked
            onClick={filter.open && searchLocked ? ignore : filter.onToggle}
            onOpen={filter.onOpen}
          />
        </Toolbar.Group>
      </Toolbar>
      {filter.open && (
        // Escape in the field closes the filter, as the toggle does
        <Toolbar fields onClose={searchLocked ? undefined : filter.onClose}>
          <Toolbar.FilterInput
            value={search}
            onChange={onSearchChange}
            autoFocus={filter.autoFocus}
            onClose={filter.onClose}
            disabled={searchLocked}
          />
        </Toolbar>
      )}
    </>
  );
}

// The pages of the list. The kit shows the pages when there is more than
// one, and the "Show" select when the list is longer than its smallest page.
function RecordsPagination({
  currentPage,
  perPage,
  totalEntries,
  disabled,
  onPageChange,
  onPerPageChange,
}: {
  currentPage: number;
  perPage: number;
  totalEntries: number;
  disabled: boolean;
  onPageChange: (page: number) => void;
  onPerPageChange: (perPage: number) => void;
}) {
  return (
    <Toolbar>
      <Toolbar.Pagination
        currentPage={currentPage}
        perPage={perPage}
        totalEntries={totalEntries}
        disabled={disabled}
        onChange={onPageChange}
        perPageSelect={{
          options: PER_PAGE_SELECT_OPTIONS,
          onChange: onPerPageChange,
        }}
      />
    </Toolbar>
  );
}

function hasPagination(totalEntries: number, perPage: number): boolean {
  return totalEntries > Math.min(perPage, ...PER_PAGE_OPTIONS);
}

// The progress of a long action, after the actions of the selection bar
function ActionProgress({
  text,
  onCancel,
}: {
  text: string;
  onCancel: () => void;
}) {
  return (
    <div className={s.progress}>
      <span role="status" aria-live="polite">
        {text}
      </span>
      <Button
        tone="overlay"
        size="micro"
        label="Cancel remaining"
        onClick={onCancel}
      />
    </div>
  );
}

// "Select all matching records" shows outside "Show selection", when the
// matches do not fit in one page and the selection is not all of them yet
function selectAllMatchingCountOf(args: {
  showingSelected: boolean;
  totalCount: number;
  perPage: number;
  selectedCount: number;
  selectionBelongsToCurrentFilter: boolean;
}): number | null {
  const offered =
    !args.showingSelected &&
    args.totalCount > args.perPage &&
    (!args.selectionBelongsToCurrentFilter ||
      args.selectedCount < args.totalCount);
  return offered ? args.totalCount : null;
}

// Move to stage applies to the records of one model with a workflow. When
// the selection mixes models and one of them has a workflow, the action
// stays visible and tells why it is disabled.
function moveBarActionOf(args: {
  client: Client | null;
  moveContext: MoveSelectionContext;
  selectionInput: SelectionInput;
  onPick: (
    destination: WorkflowStageOption,
    workflowId: string,
    workflowStageIds: readonly string[],
  ) => void;
}): MoveBarAction | null {
  const { client, moveContext } = args;
  if (moveContext.enabled) {
    return client
      ? {
          menu: (
            <MoveToStageMenu
              client={client}
              workflowId={moveContext.workflowId}
              selectionInput={args.selectionInput}
              onPick={args.onPick}
            />
          ),
        }
      : null;
  }
  const someModelHasWorkflow = args.selectionInput.items.some((item) =>
    Boolean(
      args.selectionInput.modelsById.get(item.relationships.item_type.data.id)
        ?.workflowId,
    ),
  );
  return someModelHasWorkflow
    ? { disabledReason: moveContext.disabledReason }
    : null;
}

// What the state of the page locks, and what it shows, now
function pageFlagsOf(args: {
  busyAction: BusyAction | null;
  collectingSelection: boolean;
  orderingPending: boolean;
  displayLoading: boolean;
  presentationsLoading: boolean;
  showingSelected: boolean;
  selectedPageLoadStarted: boolean;
  firstLoadDone: boolean;
  rowCount: number;
  query: string;
}) {
  const actionRunning = args.busyAction !== null || args.collectingSelection;
  const tableDisabled = actionRunning || args.orderingPending;
  // The rows of the list are on the way: another page loads, a Preview order
  // waits for the fields of the model, or "Show selection" has not started to
  // load the selected records yet
  const listLoading =
    args.displayLoading ||
    (args.showingSelected
      ? !args.selectedPageLoadStarted
      : args.orderingPending);

  return {
    tableDisabled,
    filtersDisabled: disabledFiltersReason({
      actionRunning,
      orderingPending: args.orderingPending,
    }),
    selectionEnabled: !(
      tableDisabled ||
      args.displayLoading ||
      args.presentationsLoading
    ),
    paginationDisabled: args.displayLoading || tableDisabled,
    barRunning:
      args.busyAction ??
      (args.collectingSelection ? ('selectAllMatching' as const) : null),
    barLoading: args.orderingPending || args.displayLoading,
    // The spinner of the title bar shows on reloads, never before the first
    // load, and while a bulk action saves
    titleBusy:
      args.firstLoadDone &&
      (listLoading || args.presentationsLoading || args.busyAction !== null),
    waitingForRows: args.rowCount === 0 && listLoading,
    // None of the selected records of this page loaded: they were deleted, or
    // the user can no longer read them. They stay selected.
    selectionUnavailable:
      args.showingSelected && !listLoading && args.rowCount === 0,
    searching: args.query !== '' && !args.showingSelected,
  };
}

function progressTextOf(
  locale: string,
  collectionProgress: string | null,
  bulkProgress: BulkOperationProgress | null,
): string | null {
  if (collectionProgress) return collectionProgress;
  return bulkProgress ? bulkProgressText(locale, bulkProgress) : null;
}

const PANE_STATES: ReadonlySet<PageState> = new Set([
  'ready',
  'no-results',
  'failed',
]);

export default function AllRecordsPage({ ctx }: Props) {
  const queryState = useMemo(
    () => parseQueryState(ctx.location.search),
    [ctx.location.search],
  );
  const [searchInput, setSearchInput] = useState(queryState.query);
  const searchWasEdited = useRef(false);
  const debouncedSearch = useDebouncedValue(searchInput, 300);
  const [selectedById, setSelectedById] = useState<
    ReadonlyMap<string, RawItem>
  >(new Map());
  const selectionFilterScope = useRef<string | null>(null);
  const matchingFilterScope = JSON.stringify([
    queryState.model,
    queryState.status,
    queryState.query,
  ]);
  const [showingSelected, setShowingSelected] = useState(false);
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [selectionPage, setSelectionPage] = useState(0);
  const [collectingSelection, setCollectingSelection] = useState(false);
  const [collectionProgress, setCollectionProgress] = useState<string | null>(
    null,
  );
  const [bulkProgress, setBulkProgress] =
    useState<BulkOperationProgress | null>(null);
  const actionController = useRef<AbortController | null>(null);
  const actionLocked = useRef(false);

  const updateLocation = useCallback(
    (patch: Partial<QueryState>) => {
      const next = updateQueryState(queryState, patch);
      const onlyChangesPage = Object.keys(patch).every((key) => key === 'page');
      if (!onlyChangesPage) {
        setShowingSelected(false);
      }

      void ctx.navigateTo(
        buildPluginPageUrl({
          environment: ctx.environment,
          isEnvironmentPrimary: ctx.isEnvironmentPrimary,
          pluginId: ctx.plugin.id,
          state: next,
        }),
      );
    },
    [
      ctx.environment,
      ctx.isEnvironmentPrimary,
      ctx.navigateTo,
      ctx.plugin.id,
      queryState,
    ],
  );
  const clearUnsupportedPreviewOrder = useCallback(
    () => updateLocation({ orderBy: null }),
    [updateLocation],
  );

  useEffect(() => {
    searchWasEdited.current = false;
    setSearchInput(queryState.query);
  }, [queryState.query]);

  useEffect(() => {
    if (!searchWasEdited.current || debouncedSearch !== searchInput) {
      return;
    }

    const normalized = debouncedSearch.trim();
    if (normalized !== queryState.query) {
      updateLocation({ query: normalized });
    }
  }, [debouncedSearch, queryState.query, searchInput, updateLocation]);

  const client = useMemo(
    () =>
      ctx.currentUserAccessToken
        ? buildCmaClient({
            currentUserAccessToken: ctx.currentUserAccessToken,
            environment: ctx.environment,
            cmaBaseUrl: ctx.cmaBaseUrl,
          })
        : null,
    [ctx.cmaBaseUrl, ctx.currentUserAccessToken, ctx.environment],
  );
  const itemTypes = useMemo(() => rawItemTypes(ctx.itemTypes), [ctx.itemTypes]);
  const models = useMemo(() => getRegularModels(itemTypes), [itemTypes]);
  const modelsById = useMemo(() => modelMap(models), [models]);
  const modelFilterOptions = useMemo(
    () => [
      { label: 'All models', value: '' },
      ...models.map((model) => ({ label: model.name, value: model.id })),
    ],
    [models],
  );
  const schemaVersion = useMemo(
    () => models.map((model) => model.id).join(','),
    [models],
  );
  const ordering = useOrderingState({
    itemTypes,
    modelId: queryState.model,
    status: queryState.status,
    orderBy: queryState.orderBy,
    loadItemTypeFields: ctx.loadItemTypeFields,
    onUnsupportedPreviewOrder: clearUnsupportedPreviewOrder,
  });

  const selectionScope = `${ctx.site.id}:${ctx.environment}:${ctx.currentUser.type}:${ctx.currentUser.id}`;
  useLayoutEffect(() => {
    void selectionScope;
    actionController.current?.abort();
    actionController.current = null;
    actionLocked.current = false;
    setBusyAction(null);
    setCollectingSelection(false);
    setCollectionProgress(null);
    setBulkProgress(null);
    selectionFilterScope.current = null;
    setSelectedById(new Map());
    setShowingSelected(false);
    setSelectionPage(0);
    return () => {
      actionController.current?.abort();
      actionController.current = null;
    };
  }, [selectionScope]);

  useEffect(() => {
    setSelectedById((current) =>
      retainSelectionForModels(current, new Set(modelsById.keys())),
    );
  }, [modelsById]);

  useEffect(() => {
    if (queryState.model && !modelsById.has(queryState.model)) {
      updateLocation({ model: null });
    }
  }, [modelsById, queryState.model, updateLocation]);

  const itemsPage = useItemsPage({
    client,
    queryState,
    enabled:
      models.length > 0 && !ordering.pending && ordering.serverOrderBy !== null,
    refreshVersion,
    schemaVersion,
    serverOrderBy: ordering.serverOrderBy ?? undefined,
    models,
  });

  useEffect(() => {
    if (!itemsPage.loaded) {
      return;
    }

    const nextPage = clampPage(
      queryState.page,
      itemsPage.totalCount,
      queryState.perPage,
    );
    if (nextPage !== queryState.page) {
      updateLocation({ page: nextPage });
    }
  }, [
    itemsPage.loaded,
    itemsPage.totalCount,
    queryState.page,
    queryState.perPage,
    updateLocation,
  ]);

  const presentationResolver = useMemo(() => {
    // A record refresh must also reload cached references and upload previews.
    void refreshVersion;
    if (!client) {
      return null;
    }

    return createPresentationResolver({
      itemTypes,
      locales: ctx.site.attributes.locales,
      preferredLocale: undefined,
      timeZone: ctx.site.attributes.timezone,
      imgixHost: ctx.site.attributes.imgix_host ?? undefined,
      googleMapsApiToken:
        ctx.site.attributes.google_maps_api_token ?? undefined,
      loadFields: async (itemTypeIds): Promise<RawField[]> => {
        const fields = await mapBounded(itemTypeIds, (itemTypeId) =>
          ctx.loadItemTypeFields(itemTypeId),
        );
        return fields.flat() as RawField[];
      },
      loadItems: (ids) => loadItemsById(client, ids),
      loadUploads: (ids) => loadUploadsById(client, ids),
    });
  }, [
    client,
    ctx.loadItemTypeFields,
    ctx.site.attributes.google_maps_api_token,
    ctx.site.attributes.imgix_host,
    ctx.site.attributes.locales,
    ctx.site.attributes.timezone,
    itemTypes,
    refreshVersion,
  ]);

  const selectedItems = useMemo(
    () => [...selectedById.values()],
    [selectedById],
  );
  const selectedPage = useMemo(
    () =>
      selectedItems.slice(
        selectionPage * queryState.perPage,
        (selectionPage + 1) * queryState.perPage,
      ),
    [selectedItems, selectionPage, queryState.perPage],
  );
  const selectedItemsPage = useSelectedItemsPage(
    client,
    selectedPage,
    showingSelected,
    refreshVersion,
  );
  // Until the selected records start to load, the hook still holds the empty
  // result of the list mode, which is not an empty selection page
  const [selectedPageLoadStarted, setSelectedPageLoadStarted] = useState(false);
  useEffect(() => {
    if (!showingSelected) {
      setSelectedPageLoadStarted(false);
    } else if (selectedItemsPage.loading) {
      setSelectedPageLoadStarted(true);
    }
  }, [showingSelected, selectedItemsPage.loading]);
  useEffect(() => {
    if (itemsPage.loaded) {
      setSelectedById((current) =>
        synchronizeSelection(current, itemsPage.items),
      );
    }
  }, [itemsPage.items, itemsPage.loaded]);
  useEffect(() => {
    if (!selectedItemsPage.loading && !selectedItemsPage.error) {
      setSelectedById((current) =>
        synchronizeSelection(current, selectedItemsPage.items),
      );
    }
  }, [
    selectedItemsPage.items,
    selectedItemsPage.loading,
    selectedItemsPage.error,
  ]);
  const selectionRows = useSelectionRows({
    page: selectedItemsPage,
    loadStarted: selectedPageLoadStarted,
    selectedById,
  });
  const displayItems = displayPage(
    showingSelected,
    selectionRows,
    itemsPage.items,
  );
  const displayLoading = displayPage(
    showingSelected,
    selectedItemsPage.loading,
    itemsPage.loading,
  );
  const displayError = displayPage(
    showingSelected,
    selectedItemsPage.error,
    itemsPage.error,
  );
  useEffect(() => {
    setSelectionPage((page) =>
      clampPage(page, selectedItems.length, queryState.perPage),
    );
  }, [selectedItems.length, queryState.perPage]);
  const presentations = usePresentations(presentationResolver, displayItems);

  useEffect(() => {
    if (selectedItems.length === 0 && showingSelected) {
      setShowingSelected(false);
    }
  }, [selectedItems.length, showingSelected]);

  const tableRows = useMemo<TableRecord[]>(
    () =>
      displayItems.map((item) => {
        const presentation = presentations.byItemId.get(item.id);
        const model = modelsById.get(item.relationships.item_type.data.id);
        const status = presentation?.status ?? getItemStatus(item);
        const validity =
          presentation?.validity ??
          getItemValidity(item, model?.draftModeActive ?? false);

        return {
          id: item.id,
          title: presentation?.title ?? `Record #${item.id}`,
          imageUrl: presentation?.image?.url,
          model: model?.name ?? 'Unknown model',
          status,
          statusLabel: presentation?.statusLabel ?? ITEM_STATUS_LABEL[status],
          updatedAt: isoDate(item.meta.updated_at),
          createdAt: isoDate(item.meta.created_at),
          publishedValid: validity.publishedValid,
          currentValid: validity.currentValid,
          draftModeActive: model?.draftModeActive ?? false,
          url: buildRecordEditorUrl({
            environment: ctx.environment,
            isEnvironmentPrimary: ctx.isEnvironmentPrimary,
            modelId: item.relationships.item_type.data.id,
            itemId: item.id,
          }),
        };
      }),
    [
      ctx.environment,
      ctx.isEnvironmentPrimary,
      displayItems,
      modelsById,
      presentations.byItemId,
    ],
  );

  const selectedIds = useMemo(
    () => new Set(selectedById.keys()),
    [selectedById],
  );
  const itemById = useMemo(
    () => new Map(displayItems.map((item) => [item.id, item])),
    [displayItems],
  );
  const storageKey = columnSettingsStorageKey({
    siteId: ctx.site.id,
    environment: ctx.environment,
    userId: ctx.currentUser.id,
  });
  const [columns, setColumns] = useColumnSettings(storageKey);
  const creatorRoles = useMemo(
    () => creatorRoleMap(ctx.users, ctx.ssoUsers, ctx.owner),
    [ctx.owner, ctx.ssoUsers, ctx.users],
  );
  const permissions = useMemo<PermissionContext>(
    () => ({
      role: ctx.currentRole,
      environment: ctx.environment,
      currentUser: {
        id: ctx.currentUser.id,
        type: ctx.currentUser.type,
      },
      creatorRoleByIdentity: creatorRoles,
    }),
    [
      creatorRoles,
      ctx.currentRole,
      ctx.currentUser.id,
      ctx.currentUser.type,
      ctx.environment,
    ],
  );
  const selectionInput = useMemo(
    () => ({ items: selectedItems, modelsById, permissions }),
    [modelsById, permissions, selectedItems],
  );
  const deleteEvaluation = useMemo(
    () => evaluateSelection({ ...selectionInput, action: 'delete' }),
    [selectionInput],
  );
  const publishEvaluation = useMemo(
    () => evaluateSelection({ ...selectionInput, action: 'publish' }),
    [selectionInput],
  );
  const unpublishEvaluation = useMemo(
    () => evaluateSelection({ ...selectionInput, action: 'unpublish' }),
    [selectionInput],
  );
  const moveContext = useMemo(
    () => getMoveSelectionContext(selectionInput),
    [selectionInput],
  );

  function clearSelection(): void {
    selectionFilterScope.current = null;
    setSelectedById(new Map());
    setShowingSelected(false);
    setSelectionPage(0);
  }

  function noteSelectionFilter(): void {
    if (selectedById.size === 0) {
      selectionFilterScope.current = matchingFilterScope;
    } else if (selectionFilterScope.current !== matchingFilterScope) {
      selectionFilterScope.current = null;
    }
  }

  function refresh(): void {
    setRefreshVersion((value) => value + 1);
  }

  function beginAction(action?: BusyAction): AbortController | null {
    if (actionLocked.current) return null;
    actionLocked.current = true;
    const controller = new AbortController();
    actionController.current = controller;
    if (action) setBusyAction(action);
    return controller;
  }

  function finishAction(controller: AbortController): void {
    if (actionController.current !== controller) return;
    actionController.current = null;
    actionLocked.current = false;
    setBusyAction(null);
    setCollectingSelection(false);
    setCollectionProgress(null);
    setBulkProgress(null);
  }

  function isActive(controller: AbortController): boolean {
    return (
      actionController.current === controller && !controller.signal.aborted
    );
  }

  function reportActionError(
    controller: AbortController,
    message: string,
  ): void {
    if (actionController.current !== controller) return;
    ctx.alert(message);
    refresh();
  }

  function selectionLoadError(
    controller: AbortController,
    error: unknown,
  ): void {
    if (!isActive(controller)) return;
    reportActionError(
      controller,
      error instanceof Error
        ? error.message
        : 'Could not select matching records.',
    );
  }

  async function selectAllMatching(): Promise<void> {
    if (!client) return;
    const controller = beginAction();
    if (!controller) return;
    setCollectingSelection(true);
    setCollectionProgress('Selecting matching records…');
    try {
      const selection = await collectSelection(client, queryState, {
        signal: controller.signal,
        modelIds: models.map((model) => model.id),
        onProgress: (count, total) => {
          if (actionController.current === controller) {
            setCollectionProgress(
              collectionProgressText(ctx.ui.locale, count, total),
            );
          }
        },
      });
      if (isActive(controller)) {
        selectionFilterScope.current = matchingFilterScope;
        setSelectedById(selection);
        setSelectionPage(0);
      }
    } catch (error) {
      selectionLoadError(controller, error);
    } finally {
      finishAction(controller);
    }
  }

  function operationProgress(controller: AbortController, count: number) {
    return count > MAX_BULK_ITEMS
      ? (progress: BulkOperationProgress) => {
          if (actionController.current === controller)
            setBulkProgress(progress);
        }
      : undefined;
  }

  async function selectionForAction(
    controller: AbortController,
  ): Promise<SelectionInput | null> {
    if (!client) return null;
    const items = await loadCurrentSelection(client, selectedItems, {
      signal: controller.signal,
    });
    if (!isActive(controller)) return null;
    setSelectedById(new Map(items.map((item) => [item.id, item])));
    return { items, modelsById, permissions };
  }

  async function applyBulkResult(
    controller: AbortController,
    currentSelection: SelectionInput,
    result: BulkOperationResult,
    submittedIds: readonly string[],
  ): Promise<void> {
    if (actionController.current !== controller) return;
    reportBulkResult(ctx, result);
    const retained = new Set(result.remainingItemIds);
    const submitted = new Set(submittedIds);
    const remaining = currentSelection.items.filter(
      (item) => !submitted.has(item.id) || retained.has(item.id),
    );
    selectionFilterScope.current = null;
    setSelectedById(new Map(remaining.map((item) => [item.id, item])));
    setShowingSelected(false);
    refresh();
    if (!client || remaining.length === 0) return;
    try {
      // A partially successful batch retains all its IDs; refresh their stages
      // and creator scopes before making the selection available again.
      const items = await loadCurrentSelection(client, remaining, {
        // A partial delete may have removed IDs that its count-only result
        // could not identify. The current read reconciles those missing IDs.
        omitMissing: result.operation === 'delete',
        signal: controller.signal,
      });
      if (actionController.current === controller) {
        setSelectedById(new Map(items.map((item) => [item.id, item])));
      }
    } catch (error) {
      if (!isActive(controller)) return;
      ctx.alert(
        `The action finished, but the remaining selection could not be refreshed: ${
          error instanceof Error ? error.message : 'The request failed.'
        }`,
      );
    }
  }

  async function runSelectionAction(
    action: BulkSelectionAction,
  ): Promise<void> {
    if (!client) {
      ctx.alert(
        'This action requires the current user access token permission.',
      );
      return;
    }
    const controller = beginAction(action);
    if (!controller) return;
    try {
      const currentSelection = await selectionForAction(controller);
      if (!currentSelection) return;
      const evaluation = evaluateSelection({ ...currentSelection, action });
      if (evaluation.disabledReason) {
        reportActionError(controller, evaluation.disabledReason);
        return;
      }
      const confirmed = await confirmSelectionAction(ctx, action, evaluation);
      if (!confirmed || controller.signal.aborted) return;
      setShowingSelected(false);
      const result = await executeBulkOperation(
        client,
        {
          operation: action,
          itemIds: evaluation.itemIds,
        },
        {
          signal: controller.signal,
          onProgress: operationProgress(controller, evaluation.itemIds.length),
        },
      );
      await applyBulkResult(
        controller,
        currentSelection,
        result,
        evaluation.itemIds,
      );
    } catch (error) {
      reportActionError(controller, bulkErrorMessage(action, error));
    } finally {
      finishAction(controller);
    }
  }

  function reportMoveCheck(
    controller: AbortController,
    check: Extract<MoveCheck, { message: string }>,
  ): void {
    if (check.refresh) {
      reportActionError(controller, check.message);
    } else {
      ctx.alert(check.message);
    }
  }

  async function runMoveToStage(
    destination: WorkflowStageOption,
    workflowId: string,
    workflowStageIds: readonly string[],
  ): Promise<void> {
    if (!client) {
      ctx.alert(
        'This action requires the current user access token permission.',
      );
      return;
    }
    const controller = beginAction('move');
    if (!controller) return;
    try {
      const currentSelection = await selectionForAction(controller);
      if (!currentSelection) return;
      const check = checkMoveDestination({
        selection: currentSelection,
        destination,
        workflowId,
        workflowStageIds,
      });
      if ('message' in check) {
        reportMoveCheck(controller, check);
        return;
      }
      const { evaluation } = check;
      const confirmed = await confirmMoveToStage(ctx, destination, evaluation);
      if (!confirmed || controller.signal.aborted) return;
      const result = await executeBulkOperation(
        client,
        {
          operation: 'move_to_stage',
          itemIds: evaluation.itemIds,
          stage: destination.id,
        },
        {
          signal: controller.signal,
          onProgress: operationProgress(controller, evaluation.itemIds.length),
        },
      );
      await applyBulkResult(
        controller,
        currentSelection,
        result,
        evaluation.itemIds,
      );
    } catch (error) {
      reportActionError(controller, bulkErrorMessage('move_to_stage', error));
    } finally {
      finishAction(controller);
    }
  }

  function cancelRemaining(): void {
    actionController.current?.abort();
    setCollectionProgress((value) => (value ? 'Cancelling…' : null));
  }

  const filter = useFilterToolbar({
    isFiltering: searchInput !== '' || queryState.query !== '',
    onClear: () => {
      searchWasEdited.current = false;
      setSearchInput('');
      updateLocation({ query: '' });
    },
  });

  const loaded = useLoadedResult(itemsPage, matchingFilterScope);
  const loadedTotalCount = loaded?.totalCount;
  const pageState = pageStateOf({
    hasToken: Boolean(ctx.currentUserAccessToken),
    hasModels: models.length > 0,
    failed: Boolean(displayError),
    showingSelected,
    loaded,
    filterScope: matchingFilterScope,
    queryState,
  });
  const flags = pageFlagsOf({
    busyAction,
    collectingSelection,
    orderingPending: ordering.pending,
    displayLoading,
    presentationsLoading: presentations.loading,
    showingSelected,
    selectedPageLoadStarted,
    firstLoadDone: loadedTotalCount !== undefined,
    rowCount: tableRows.length,
    query: queryState.query,
  });
  const listedCount = displayPage(
    showingSelected,
    selectedItems.length,
    loadedTotalCount ?? 0,
  );
  const progressText = progressTextOf(
    ctx.ui.locale,
    collectionProgress,
    bulkProgress,
  );

  const selectionActions = buildSelectionBarActions({
    running: flags.barRunning,
    loading: flags.barLoading,
    showingSelected,
    selectAllMatchingCount: selectAllMatchingCountOf({
      showingSelected,
      totalCount: itemsPage.totalCount,
      perPage: queryState.perPage,
      selectedCount: selectedItems.length,
      selectionBelongsToCurrentFilter:
        selectionFilterScope.current === matchingFilterScope,
    }),
    evaluations: {
      publish: publishEvaluation,
      unpublish: unpublishEvaluation,
      delete: deleteEvaluation,
    },
    move: moveBarActionOf({
      client,
      moveContext,
      selectionInput,
      onPick: (destination, workflowId, workflowStageIds) => {
        void runMoveToStage(destination, workflowId, workflowStageIds);
      },
    }),
    // A click while another action runs returns nothing, thus the button of
    // the running action keeps its spinner.
    onSelectAllMatching: () =>
      actionLocked.current ? undefined : selectAllMatching(),
    onToggleSelection: () => {
      setSelectionPage(0);
      setShowingSelected((current) => !current);
    },
    onInvertSelection: () => {
      noteSelectionFilter();
      setSelectedById((current) => invertPageSelection(current, displayItems));
    },
    onRun: (action) =>
      actionLocked.current ? undefined : runSelectionAction(action),
  });

  const table = (
    <AllRecordsTable
      columns={columns}
      rows={tableRows}
      selectedIds={selectedIds}
      orderBy={displayedOrderBy(queryState)}
      sortableColumnIds={ordering.columnIds}
      sortingEnabled={!queryState.query}
      selectionEnabled={flags.selectionEnabled}
      onColumnsChange={setColumns}
      onOrderByChange={(orderBy) => {
        if (!flags.tableDisabled) updateLocation({ orderBy });
      }}
      onToggleRow={(itemId) => {
        const item = itemById.get(itemId);
        if (!item) {
          return;
        }
        noteSelectionFilter();
        setSelectedById((current) => {
          const next = new Map(current);
          if (next.has(itemId)) {
            next.delete(itemId);
          } else {
            next.set(itemId, compactSelectedItem(item));
          }
          return next;
        });
      }}
      onTogglePage={(selected) => {
        noteSelectionFilter();
        setSelectedById((current) =>
          setPageSelection(current, displayItems, selected),
        );
      }}
    />
  );

  const pane = (
    <Pane
      ariaLabel="Records"
      header={
        <RecordsTitleBar
          count={loadedTotalCount === undefined ? null : listedCount}
          locale={ctx.ui.locale}
          busy={flags.titleBusy}
          modelOptions={modelFilterOptions}
          queryState={queryState}
          filtersDisabled={flags.filtersDisabled}
          searchLocked={flags.tableDisabled}
          search={searchInput}
          onSearchChange={(value) => {
            searchWasEdited.current = true;
            setSearchInput(value);
            // A row that opened for a search of the URL is the user's once
            // they edit it: it stays open when they empty it by typing, and
            // only the magnifier or the ✕ close it
            filter.onOpen();
          }}
          filter={filter}
          onFilter={updateLocation}
        />
      }
      footer={
        hasPagination(listedCount, queryState.perPage) && (
          <RecordsPagination
            currentPage={displayPage(
              showingSelected,
              selectionPage,
              queryState.page,
            )}
            perPage={queryState.perPage}
            totalEntries={listedCount}
            disabled={flags.paginationDisabled}
            onPageChange={(page) =>
              showingSelected
                ? setSelectionPage(page)
                : updateLocation({ page })
            }
            onPerPageChange={(perPage) => {
              setSelectionPage(0);
              updateLocation({ perPage });
            }}
          />
        )
      }
      slideUpToolbar={
        <MultipleSelectionActionBar
          open={selectedItems.length > 0}
          status={{
            id: 'allRecords.selected',
            values: { count: selectedItems.length },
          }}
          onDeselectAll={() => {
            if (!actionLocked.current) clearSelection();
          }}
          actions={selectionActions}
          extra={
            progressText && (
              <ActionProgress text={progressText} onCancel={cancelRemaining} />
            )
          }
        />
      }
    >
      <ListArea>
        <RecordsArea
          state={pageState}
          error={displayError}
          waitingForRows={flags.waitingForRows}
          selectionUnavailable={flags.selectionUnavailable}
          searching={flags.searching}
          onRetry={refresh}
        >
          {table}
        </RecordsArea>
      </ListArea>
    </Pane>
  );

  return (
    <Canvas ctx={ctx} noAutoResizer texts={TEXTS}>
      <Main className={s.layout}>
        {PANE_STATES.has(pageState) ? (
          pane
        ) : (
          <PageBlankSlate state={pageState} />
        )}
      </Main>
    </Canvas>
  );
}
