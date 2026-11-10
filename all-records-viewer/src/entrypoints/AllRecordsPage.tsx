import type { Client } from '@datocms/cma-client-browser';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import Canvas from 'datocms-react-ui/Canvas';
import { useDateSettings } from 'datocms-react-ui/DateSettings';
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
import { FilterBar } from '../components/FilterBar';
import { FilterDropdown } from '../components/FilterDropdown';
import { MoveToStageMenu } from '../components/MoveToStageMenu';
import type { TableRecord } from '../components/types';
import { useColumnSettings } from '../components/useColumnSettings';
import { MAX_BULK_ITEMS, PER_PAGE_OPTIONS } from '../constants';
import { buildCmaClient } from '../data/cma';
import { collectSelection } from '../data/collectSelection';
import { errorAdvice, type LoadError } from '../data/errors';
import { loadItemsById, loadUploadsById, mapBounded } from '../data/loadById';
import { getRegularModels } from '../data/models';
import {
  previewOrderingField,
  serverOrderBy,
  sortableColumnIds,
} from '../data/ordering';
import { DEFAULT_ORDER_BY, throwIfItemsRequestAborted } from '../data/query';
import {
  filterFieldsFor,
  hasActiveFilters,
  hasStatusFilter,
  localeName,
} from '../filters/filters';
import type { FilterField } from '../filters/types';
import { useCreatorOptions } from '../filters/useCreatorOptions';
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
import { getItemStatus, getItemValidity } from '../presentation/status';
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
import { formatNumber, formatRecordCount, TEXTS } from '../texts';
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

const PAST_TENSE: Record<BulkSelectionAction, string> = {
  delete: 'deleted',
  publish: 'published',
  unpublish: 'unpublished',
};

// What the bar says while an action runs
const PROGRESS_VERB: Record<BusyAction, string> = {
  delete: 'Deleting',
  publish: 'Publishing',
  unpublish: 'Unpublishing',
  move: 'Moving',
};

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

// The records that the question is about: "3 records", or "1 of 3 records"
// when the action can't apply to some of the selected records
function confirmationCount(
  locale: string,
  evaluation: SelectionEvaluation,
): string {
  return evaluation.excludedCount > 0
    ? `${formatNumber(locale, evaluation.eligibleCount)} of ${formatRecordCount(
        locale,
        evaluation.selectedCount,
      )}`
    : formatRecordCount(locale, evaluation.eligibleCount);
}

// What the question says under the title: that a delete can't be undone,
// why the action leaves some selected records out, or else what it does.
// When the role is the only reason, it says so with the words of the toast
// of a refused action.
function confirmationContent(
  locale: string,
  action: BulkSelectionAction,
  evaluation: SelectionEvaluation,
): string {
  const count = formatNumber(locale, evaluation.excludedCount);
  let others: string | null = null;
  if (evaluation.excludedCount > 0) {
    others =
      evaluation.deniedCount === evaluation.excludedCount
        ? `Your role can't ${action} the other ${count}.`
        : `The other ${count} can't be ${PAST_TENSE[action]}.`;
  }
  const one = evaluation.eligibleCount === 1;

  switch (action) {
    case 'delete':
      return others
        ? `This can't be undone. ${others}`
        : "This can't be undone.";
    case 'publish':
      return (
        others ??
        (one ? 'Its latest changes go live.' : 'Their latest changes go live.')
      );
    case 'unpublish':
      return (
        others ?? (one ? 'It goes back to draft.' : 'They go back to draft.')
      );
  }
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

function displayedOrderBy(queryState: QueryState) {
  return queryState.query ? null : (queryState.orderBy ?? DEFAULT_ORDER_BY);
}

function useOrderingState(args: {
  itemTypes: readonly RawItemType[];
  modelId: string | null;
  filters: QueryState['filters'];
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
  const statusFiltered = hasStatusFilter(args.filters);
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
    if (statusFiltered) {
      result.delete('_status');
    }
    return result;
  }, [statusFiltered, fields, fieldsLoaded, selectedItemType]);

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
    selectedItemType,
    fields,
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
// not apply to any selected record does not show: as in the record editor,
// Publish needs a record with changes to publish, and Unpublish a record
// that is published. Nor do the main actions
// while the selected records can't be shown, nor "Invert selection" in "Show
// selection", where every row is selected. While an action gets ready, its
// own button shows a spinner and the others say why they wait. Once it runs,
// the bar shows only its progress.
function buildSelectionBarActions(args: {
  running: SelectionBarActionId | null;
  /** The action runs, and the status of the bar shows how far it got */
  progressing: boolean;
  loading: boolean;
  showingSelected: boolean;
  /** "Show selection" shows none of the selected records: they are gone */
  selectionUnavailable: boolean;
  /** The number of matching records, when the bar offers to select them */
  selectAllMatchingCount: number | null;
  /** A filter or a search is on: the records to select are the matches */
  filtered: boolean;
  evaluations: Record<BulkSelectionAction, SelectionEvaluation>;
  move: MoveBarAction | null;
  onSelectAllMatching: () => void | Promise<void>;
  onToggleSelection: () => void;
  onInvertSelection: () => void;
  onRun: (action: BulkSelectionAction) => void | Promise<void>;
}): (MaybeAction | MaybeAction[])[] {
  const waitReason =
    args.running || args.progressing
      ? ACTION_RUNNING
      : args.loading
        ? RECORDS_LOADING
        : undefined;
  const disabled = (id: SelectionBarActionId) =>
    args.running === id ? undefined : waitReason;
  const offersMainActions = !args.progressing && !args.selectionUnavailable;
  const mainAction = (
    action: BulkSelectionAction,
    label: string,
    statuses?: readonly RawItem['meta']['status'][],
  ): MaybeAction =>
    offersMainActions &&
    args.evaluations[action].items.some(
      (item) => !statuses || statuses.includes(item.meta.status),
    ) && {
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
    !args.progressing && [
      args.selectAllMatchingCount !== null && {
        id: 'selectAllMatching',
        label: {
          id: args.filtered
            ? 'allRecords.selectAllMatching'
            : 'allRecords.selectAll',
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
      !args.showingSelected && {
        id: 'invert',
        label: 'Invert selection',
        disabled: disabled('invert'),
        onClick: args.onInvertSelection,
      },
    ],
    mainAction('publish', 'Publish', ['draft', 'updated']),
    mainAction('unpublish', 'Unpublish', ['published', 'updated']),
    offersMainActions && move,
    mainAction('delete', 'Delete'),
  ];
}

// The status of the bar while an action runs: "Publishing 457 records…",
// then "Publishing 200 of 457 records…" between the batches. What failed
// waits for the toast at the end.
function progressText(
  locale: string,
  verb: string,
  done: number,
  total: number,
): string {
  const count =
    done > 0 && done < total
      ? `${formatNumber(locale, done)} of ${formatRecordCount(locale, total)}`
      : formatRecordCount(locale, total);
  return `${verb} ${count}…`;
}

function reportBulkResult(
  ctx: RenderPageCtx,
  result: BulkOperationResult,
  options: { stageName?: string; leftOut: number; alreadyThere?: number },
): void {
  const message = bulkResultMessage(result, {
    ...options,
    locale: ctx.ui.locale,
  });
  // A stop that the user asked for is not a failure
  if (result.failed > 0 || (result.unprocessed && !result.cancelled)) {
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
      title: `${label} ${confirmationCount(ctx.ui.locale, evaluation)}?`,
      content: confirmationContent(ctx.ui.locale, action, evaluation),
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

// The question before a move that the role can't make for some selected
// records. It also counts the ones already in the stage, if any.
async function confirmMoveToStage(
  ctx: RenderPageCtx,
  destination: WorkflowStageOption,
  evaluation: SelectionEvaluation,
): Promise<boolean> {
  const locale = ctx.ui.locale;
  const alreadyThere = evaluation.excludedCount - evaluation.deniedCount;
  const denied = `Your role can't move the other ${formatNumber(
    locale,
    evaluation.deniedCount,
  )}.`;
  return Boolean(
    await ctx.openConfirm({
      title: `Move ${confirmationCount(locale, evaluation)} to “${destination.name}”?`,
      content:
        alreadyThere > 0
          ? `${formatNumber(locale, alreadyThere)} ${
              alreadyThere === 1 ? 'is' : 'are'
            } already in this stage. ${denied}`
          : denied,
      choices: [{ label: 'Move', value: true, intent: 'positive' }],
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
    'Some selected records were deleted, or you can no longer read them. Clear the selection, then select the records again.';
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
      message: "Your role can't move these records to another stage.",
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
  page: {
    items: readonly RawItem[];
    loading: boolean;
    error: LoadError | null;
  };
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
    isFiltered(args.queryState),
  );
}

// The list shows only some records: a search, a model, a filter or a locale
function isFiltered(queryState: QueryState): boolean {
  return Boolean(
    queryState.query ||
      queryState.model ||
      queryState.locale ||
      hasActiveFilters(queryState.filters),
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
          title="This page needs a permission"
          description="An administrator can turn on “Current user access token” in the settings of this plugin. Then reload the page."
        />
      );
    case 'no-models':
      return (
        <BlankSlate
          placement="area"
          titleLevel={1}
          icon={<TableListIcon />}
          title="All records"
          description="The records of every model show here. There are no models yet."
        />
      );
    case 'empty':
      return (
        <BlankSlate
          placement="area"
          titleLevel={1}
          icon={<TableListIcon />}
          title="All records"
          description="The records that you can read, from every model, show here once they are created."
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
// of the selection whose records can't be shown, or the table
function RecordsArea({
  state,
  error,
  waitingForRows,
  selectionUnavailable,
  onRetry,
  onClearSelection,
  children,
}: {
  state: PageState;
  error: LoadError | null;
  waitingForRows: boolean;
  selectionUnavailable: boolean;
  onRetry: () => void;
  onClearSelection: () => void;
  children: ReactNode;
}) {
  if (state === 'failed') {
    return (
      <BlankSlate
        placement="area"
        error
        icon={<CircleExclamationIcon />}
        title="Couldn't load the records"
        code={error?.code}
        description={
          error?.connection
            ? 'Check your connection, then try again.'
            : 'Try again in a moment.'
        }
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
  // The selection bar stays: the user can also hide the selection
  if (selectionUnavailable) {
    return (
      <BlankSlate
        placement="area"
        icon={<TableListIcon />}
        title="The selected records can't be shown"
        description="They were deleted, or you can no longer read them."
        actions={<Button label="Clear selection" onClick={onClearSelection} />}
      />
    );
  }
  return children;
}

type FilterOption = { label: string; value: string };

// The title bar, and the filter row under it while the filter is open
function RecordsTitleBar({
  subtitle,
  busy,
  modelOptions,
  localeOptions,
  queryState,
  filtersDisabled,
  searchLocked,
  search,
  onSearchChange,
  filter,
  filterFields,
  locales,
  creators,
  onFilter,
}: {
  /** What the list shows ("138 records"), once the first load ends */
  subtitle: string | null;
  busy: boolean;
  modelOptions: readonly FilterOption[];
  /** "Any locale" and the locales of the project, when it has more than one */
  localeOptions: readonly FilterOption[] | null;
  queryState: QueryState;
  filtersDisabled: { reason: string } | undefined;
  searchLocked: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  filter: ReturnType<typeof useFilterToolbar>;
  filterFields: readonly FilterField[];
  locales: readonly string[];
  creators: Parameters<typeof FilterBar>[0]['creators'];
  onFilter: (patch: Partial<QueryState>) => void;
}) {
  return (
    <>
      <Pane.Header>
        <Pane.Header.Title
          level={1}
          help={
            <Toolbar.Help>
              Every record of every model, in one table. Select records to
              publish, unpublish, delete or move them to a workflow stage.
            </Toolbar.Help>
          }
        >
          All records
        </Pane.Header.Title>
        <Pane.Header.Subtitle>{subtitle}</Pane.Header.Subtitle>
        {busy && <Pane.Header.Spinner />}
        <Pane.Header.Button>
          <Toolbar.Group>
            <FilterDropdown
              tooltip="Filter by model"
              value={queryState.model ?? ''}
              options={modelOptions}
              disabled={filtersDisabled}
              onChange={(value) => onFilter({ model: value || null })}
            />
            {localeOptions && (
              <FilterDropdown
                tooltip="Only show records containing the selected localization"
                value={queryState.locale ?? ''}
                options={localeOptions}
                disabled={filtersDisabled}
                onChange={(value) => onFilter({ locale: value || null })}
              />
            )}
            <Toolbar.FilterToggle
              pressed={filter.open}
              // Closing the filter clears the search: not while it is locked
              onClick={filter.open && searchLocked ? ignore : filter.onToggle}
              onOpen={filter.onOpen}
            />
          </Toolbar.Group>
        </Pane.Header.Button>
      </Pane.Header>
      {filter.open && (
        // Escape in the field closes the filter, as the toggle does
        <Toolbar fields onClose={searchLocked ? undefined : filter.onClose}>
          <FilterBar
            search={search}
            searchDisabled={searchLocked}
            autoFocus={filter.autoFocus}
            onSearchChange={onSearchChange}
            onClose={filter.onClose}
            filters={queryState.filters}
            fields={filterFields}
            locales={locales}
            creators={creators}
            filtersDisabled={Boolean(filtersDisabled)}
            onFiltersChange={(filters) => onFilter({ filters })}
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

// The count of the title bar: what the list shows now
function subtitleText(args: {
  locale: string;
  count: number;
  showingSelected: boolean;
  searching: boolean;
}): string {
  // The bar counts the selection: the title bar says only what the list is
  if (args.showingSelected) return 'Only the selected records';
  const records = formatRecordCount(args.locale, args.count);
  // A search sorts the records by relevance: the headers do not sort
  return args.searching && args.count > 0
    ? `${records}, best matches first`
    : records;
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
  /** The selection bar shows how far the running action got */
  progressing: boolean;
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
    // load. A bulk action shows its progress in the selection bar; before
    // that, Publish, Unpublish and Delete spin their button, but the Move to
    // stage menu has no spinner while it reads the selected records again.
    titleBusy:
      args.firstLoadDone &&
      (listLoading ||
        args.presentationsLoading ||
        (args.busyAction === 'move' && !args.progressing)),
    waitingForRows: args.rowCount === 0 && listLoading,
    // None of the selected records of this page loaded: they were deleted, or
    // the user can no longer read them. They stay selected.
    selectionUnavailable:
      args.showingSelected && !listLoading && args.rowCount === 0,
    searching: args.query !== '' && !args.showingSelected,
  };
}

const PANE_STATES: ReadonlySet<PageState> = new Set([
  'ready',
  'no-results',
  'failed',
]);

export default function AllRecordsPage({ ctx }: Props) {
  return (
    <Canvas ctx={ctx} noAutoResizer texts={TEXTS}>
      <RecordsPage ctx={ctx} />
    </Canvas>
  );
}

// The page, inside its Canvas, which gives it the date settings of the user
function RecordsPage({ ctx }: Props) {
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
    queryState.filters.filter((condition) => condition.value !== null),
    queryState.locale,
    queryState.query,
  ]);
  const [showingSelected, setShowingSelected] = useState(false);
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [selectionPage, setSelectionPage] = useState(0);
  const [collectingSelection, setCollectingSelection] = useState(false);
  // While an action runs: the status of the bar, and whether it can stop
  const [progress, setProgress] = useState<{
    text: string;
    stoppable: boolean;
  } | null>(null);
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
    filters: queryState.filters,
    orderBy: queryState.orderBy,
    loadItemTypeFields: ctx.loadItemTypeFields,
    onUnsupportedPreviewOrder: clearUnsupportedPreviewOrder,
  });

  const siteLocales = ctx.site.attributes.locales;
  const localeFilterOptions = useMemo(
    () =>
      siteLocales.length > 1
        ? [
            { label: 'Any locale', value: '' },
            ...siteLocales.map((code) => ({
              label: localeName(code),
              value: code,
            })),
          ]
        : null,
    [siteLocales],
  );
  const filterFields = useMemo(
    () =>
      filterFieldsFor({
        itemType: ordering.selectedItemType,
        fields: ordering.fields,
        filterLocale: queryState.locale ?? siteLocales[0] ?? 'en',
      }),
    [
      ordering.fields,
      ordering.selectedItemType,
      queryState.locale,
      siteLocales,
    ],
  );
  const creatorOptions = useCreatorOptions(
    client,
    ctx.owner,
    queryState.filters.some((condition) => condition.field === '_creator'),
  );

  const selectionScope = `${ctx.site.id}:${ctx.environment}:${ctx.currentUser.type}:${ctx.currentUser.id}`;
  useLayoutEffect(() => {
    void selectionScope;
    actionController.current?.abort();
    actionController.current = null;
    actionLocked.current = false;
    setBusyAction(null);
    setCollectingSelection(false);
    setProgress(null);
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

  const dateSettings = useDateSettings();
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
      dateSettings,
      colorScheme: ctx.colorScheme,
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
    ctx.colorScheme,
    ctx.loadItemTypeFields,
    ctx.site.attributes.google_maps_api_token,
    ctx.site.attributes.imgix_host,
    ctx.site.attributes.locales,
    dateSettings,
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
          title: presentation?.title ?? `Record ${item.id}`,
          imageUrl: presentation?.image?.url,
          model: model?.name ?? 'Unknown model',
          status,
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

  // The cross of the bar: not while an action runs
  function deselectAll(): void {
    if (!actionLocked.current) clearSelection();
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
    setProgress(null);
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
      `Couldn't select the records. ${errorAdvice(error)}`,
    );
  }

  function showProgress(
    controller: AbortController,
    verb: string,
    done: number,
    total: number,
    stoppable: boolean,
  ): void {
    if (isActive(controller)) {
      setProgress({
        text: progressText(ctx.ui.locale, verb, done, total),
        stoppable,
      });
    }
  }

  async function selectAllMatching(): Promise<void> {
    if (!client) return;
    const controller = beginAction();
    if (!controller) return;
    setCollectingSelection(true);
    showProgress(controller, 'Selecting', 0, itemsPage.totalCount, true);
    try {
      const selection = await collectSelection(client, queryState, {
        signal: controller.signal,
        modelIds: models.map((model) => model.id),
        onProgress: (count, total) =>
          showProgress(controller, 'Selecting', count, total, true),
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

  // The progress of a running action in the bar. An action of more than
  // one batch can stop between two batches.
  function operationProgress(controller: AbortController, action: BusyAction) {
    return (progress: BulkOperationProgress) =>
      showProgress(
        controller,
        PROGRESS_VERB[action],
        progress.completed,
        progress.requested,
        progress.requested > MAX_BULK_ITEMS,
      );
  }

  // The question shows with nothing running behind it: the action looks
  // busy again only after the yes
  async function ask(
    controller: AbortController,
    action: BusyAction,
    question: () => Promise<boolean>,
  ): Promise<boolean> {
    setBusyAction(null);
    const confirmed = await question();
    if (!confirmed || controller.signal.aborted) return false;
    setBusyAction(action);
    return true;
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
    /** A move: the stage, and how many records were already in it */
    move?: { stageId: string; stageName: string; alreadyThere: number },
  ): Promise<void> {
    if (actionController.current !== controller) return;
    const submitted = new Set(submittedIds);
    reportBulkResult(ctx, result, {
      stageName: move?.stageName,
      alreadyThere: move?.alreadyThere,
      leftOut: currentSelection.items.length - submitted.size,
    });
    const retained = new Set(result.remainingItemIds);
    // What the action did leaves the selection, as the records already in
    // the stage of a move: they need nothing more
    const remaining = currentSelection.items.filter(
      (item) =>
        !(move && item.meta.stage === move.stageId) &&
        (!submitted.has(item.id) || retained.has(item.id)),
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
      ctx.alert(`The selection couldn't be updated. ${errorAdvice(error)}`);
    }
  }

  async function runSelectionAction(
    action: BulkSelectionAction,
    /** Runs when the question shows: the button stops its spinner */
    asking: () => void,
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
      const confirmed = await ask(controller, action, () => {
        asking();
        return confirmSelectionAction(ctx, action, evaluation);
      });
      if (!confirmed) return;
      setShowingSelected(false);
      const result = await executeBulkOperation(
        client,
        {
          operation: action,
          itemIds: evaluation.itemIds,
        },
        {
          signal: controller.signal,
          onProgress: operationProgress(controller, action),
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
      // The pick of a stage applies at once. The question shows only when
      // the role can't move some selected records to it: the ones already in
      // the stage need nothing.
      if (
        evaluation.deniedCount > 0 &&
        !(await ask(controller, 'move', () =>
          confirmMoveToStage(ctx, destination, evaluation),
        ))
      ) {
        return;
      }
      const result = await executeBulkOperation(
        client,
        {
          operation: 'move_to_stage',
          itemIds: evaluation.itemIds,
          stage: destination.id,
        },
        {
          signal: controller.signal,
          onProgress: operationProgress(controller, 'move'),
        },
      );
      await applyBulkResult(
        controller,
        currentSelection,
        result,
        evaluation.itemIds,
        {
          stageId: destination.id,
          stageName: destination.name,
          alreadyThere: evaluation.excludedCount - evaluation.deniedCount,
        },
      );
    } catch (error) {
      reportActionError(controller, bulkErrorMessage('move_to_stage', error));
    } finally {
      finishAction(controller);
    }
  }

  // Stops what is left: the batch that the server got still ends
  function stop(): void {
    actionController.current?.abort();
    setProgress(
      (current) => current && { text: 'Stopping…', stoppable: false },
    );
  }

  const filter = useFilterToolbar({
    isFiltering:
      searchInput !== '' ||
      queryState.query !== '' ||
      queryState.filters.length > 0,
    // The close clears the search and the tiles; the next open puts them back
    onClear: () => {
      const previous = {
        query: queryState.query,
        filters: queryState.filters,
      };
      searchWasEdited.current = false;
      setSearchInput('');
      updateLocation({ query: '', filters: [] });
      return () => {
        setSearchInput(previous.query);
        updateLocation(previous);
      };
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
    progressing: progress !== null,
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

  const selectionActions = buildSelectionBarActions({
    running: flags.barRunning,
    progressing: progress !== null,
    loading: flags.barLoading,
    showingSelected,
    selectionUnavailable: flags.selectionUnavailable,
    filtered: isFiltered(queryState),
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
      actionLocked.current
        ? undefined
        : // The button spins while the selection reloads, until the question
          // shows
          new Promise<void>((asking) => {
            void runSelectionAction(action, asking).finally(asking);
          }),
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
      selectAllHidden={progress !== null}
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
          subtitle={
            // The list shows none of the selected records: no count
            loadedTotalCount === undefined || flags.selectionUnavailable
              ? null
              : subtitleText({
                  locale: ctx.ui.locale,
                  count: listedCount,
                  showingSelected,
                  searching: flags.searching,
                })
          }
          busy={flags.titleBusy}
          modelOptions={modelFilterOptions}
          localeOptions={localeFilterOptions}
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
          filterFields={filterFields}
          locales={siteLocales}
          creators={creatorOptions}
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
          status={
            progress ? (
              <span role="status">{progress.text}</span>
            ) : (
              {
                id: 'allRecords.selected',
                values: { count: selectedItems.length },
              }
            )
          }
          onDeselectAll={deselectAll}
          actions={selectionActions}
          extra={
            progress?.stoppable && (
              <Button tone="overlay" size="micro" label="Stop" onClick={stop} />
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
          onRetry={refresh}
          onClearSelection={deselectAll}
        >
          {table}
        </RecordsArea>
      </ListArea>
    </Pane>
  );

  return (
    <Main className={s.layout}>
      {PANE_STATES.has(pageState) ? pane : <PageBlankSlate state={pageState} />}
    </Main>
  );
}
