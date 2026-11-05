import type { Client } from '@datocms/cma-client-browser';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import Canvas from 'datocms-react-ui/Canvas';
import ListArea from 'datocms-react-ui/ListArea';
import Main from 'datocms-react-ui/Main';
import MultipleSelectionActionBar, {
  type MaybeAction,
} from 'datocms-react-ui/MultipleSelectionActionBar';
import Pane from 'datocms-react-ui/Pane';
import Toolbar, { useFilterToolbar } from 'datocms-react-ui/Toolbar';
import {
  type ReactElement,
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { columnSettingsStorageKey } from '../components/columnSettings';
import { FilterDropdown } from '../components/FilterDropdown';
import { MoveToStageMenu } from '../components/MoveToStageMenu';
import { RecordsTable } from '../components/RecordsTable';
import type { TableRecord } from '../components/types';
import { useColumnSettings } from '../components/useColumnSettings';
import { DEFAULT_PER_PAGE, PER_PAGE_OPTIONS } from '../constants';
import type { StageData } from '../data/loadStage';
import {
  type BulkActions,
  type BusyAction,
  useBulkActions,
  useSelectionState,
} from '../data/useBulkActions';
import { type StageDataState, useStageData } from '../data/useStageData';
import { type TableState, useTableState } from '../data/useTableState';
import { type ThumbnailMap, useThumbnails } from '../data/useThumbnails';
import {
  CircleExclamationIcon,
  EntryIcon,
  ListCheckIcon,
  RefreshIcon,
} from '../icons';
import {
  buildCmaClient,
  describeError,
  MissingAccessTokenError,
  retryAdvice,
} from '../lib/cma';
import { modelSummary, type RecordRow } from '../lib/records';
import { pluginSettingsPath, recordEditorPath } from '../lib/routes';
import type { SelectionAction } from '../operations/types';
import { TEXTS } from '../texts';
import type {
  ColumnSetting,
  ModelSummary,
  PublicationStatus,
  StageMenuItem,
} from '../types';
import s from './StagePage.module.css';

type Props = {
  ctx: RenderPageCtx;
  menuItem: StageMenuItem | null;
};

const STATUS_LABELS: Record<PublicationStatus, string> = {
  draft: 'Draft',
  updated: 'Unpublished changes',
  published: 'Published',
};

const STATUS_FILTER_OPTIONS = [
  { label: 'All statuses', value: '' },
  { label: 'Draft', value: 'draft' },
  { label: 'Unpublished changes', value: 'updated' },
  { label: 'Published', value: 'published' },
] as const;

const PER_PAGE_SELECT_OPTIONS = [...PER_PAGE_OPTIONS];

const ACTION_RUNNING = { reason: 'Wait for the current action to finish.' };
const RECORDS_LOADING = { reason: 'Wait for the records to load.' };

const NO_ROWS: RecordRow[] = [];

function ignore(): void {}

// The count of the title bar ("1,234 records"), with the separators and the
// plural rules of the locale of the user, as the ICU texts of Canvas
function formatRecordCount(locale: string, count: number): string {
  const number = new Intl.NumberFormat(locale).format(count);
  return new Intl.PluralRules(locale).select(count) === 'one'
    ? `${number} record`
    : `${number} records`;
}

/** The roles that can open the settings of the plugin, and fix them */
function canEditSettings(ctx: RenderPageCtx): boolean {
  return ctx.currentRole.meta.final_permissions.can_edit_schema;
}

/** The link to the settings of the plugin, for the roles that can open them */
function settingsButton(ctx: RenderPageCtx): ReactNode {
  return (
    canEditSettings(ctx) && (
      <Button
        tone="primary"
        label="Open plugin settings"
        to={pluginSettingsPath(ctx, ctx.plugin.id)}
      />
    )
  );
}

/** A page whose ID doesn't match any saved entry (it was removed in the settings). */
function UnknownStagePage({ ctx }: { ctx: RenderPageCtx }) {
  return (
    <Main className={s.layout}>
      <BlankSlate
        placement="area"
        titleLevel={1}
        icon={<ListCheckIcon />}
        title="This page is no longer available"
        description="Its stage was removed from the plugin settings."
        actions={settingsButton(ctx)}
      />
    </Main>
  );
}

type Names = { stage: string; workflow: string };

function stageNames(menuItem: StageMenuItem, data: StageData | null): Names {
  const liveStage = data?.workflow?.stages.find(
    (stage) => stage.id === menuItem.stageId,
  );
  return {
    stage: liveStage?.name ?? menuItem.stageName,
    workflow: data?.workflow?.name ?? menuItem.workflowName,
  };
}

/** The title (the sidebar label) and the live names of the stage. */
function stageHeading(menuItem: StageMenuItem, data: StageData | null) {
  const names = stageNames(menuItem, data);
  return { names, title: menuItem.label ?? names.stage };
}

function needsApiAccess(ctx: RenderPageCtx, state: StageDataState): boolean {
  return (
    !ctx.currentUserAccessToken ||
    (state.status === 'error' && state.error instanceof MissingAccessTokenError)
  );
}

/** What the page is for: the "?" after the title */
function stageHelp(names: Names): ReactNode {
  return (
    <Toolbar.Help>
      The records in the {names.stage} stage of the {names.workflow} workflow,
      from every model that uses it. Select records to publish, unpublish,
      delete or move them to another stage.
    </Toolbar.Help>
  );
}

/**
 * The states where the stage lists no records, in their order: the whole
 * page, with no title bar. Null when the page shows its pane.
 */
function stageBlankSlate(args: {
  ctx: RenderPageCtx;
  state: StageDataState;
  menuItem: StageMenuItem;
  names: Names;
  title: string;
  onReload: () => void;
}): ReactNode {
  const { ctx, state, names } = args;
  if (needsApiAccess(ctx, state)) {
    return (
      <BlankSlate
        placement="area"
        titleLevel={1}
        error
        icon={<CircleExclamationIcon />}
        title="This page needs a permission"
        description={
          canEditSettings(ctx)
            ? 'Turn on “Current user access token” in the plugin settings, then reload the page.'
            : 'Ask an administrator to turn on “Current user access token” in the plugin settings.'
        }
        actions={settingsButton(ctx)}
      />
    );
  }
  if (state.status === 'loading') {
    return <BlankSlate placement="area" loading title="Loading the records" />;
  }
  if (state.status !== 'ready') return null;

  const reload = (
    <Button
      icon={RefreshIcon}
      label="Reload"
      onClick={args.onReload}
      busy={state.refreshing}
    />
  );
  if (state.data.stageMissing) {
    // Reloading can't bring it back: only the settings fix the page
    const what = state.data.workflow
      ? `The ${names.stage} stage was removed from the ${names.workflow} workflow.`
      : `The ${names.workflow} workflow was deleted.`;
    return (
      <BlankSlate
        placement="area"
        titleLevel={1}
        error
        icon={<CircleExclamationIcon />}
        title="This stage no longer exists"
        description={
          canEditSettings(ctx)
            ? `${what} Remove this page in the plugin settings.`
            : `${what} Ask an administrator to remove this page.`
        }
        actions={settingsButton(ctx)}
      />
    );
  }
  if (state.data.models.length === 0) {
    return (
      <BlankSlate
        placement="area"
        titleLevel={1}
        icon={<EntryIcon name={args.menuItem.icon} />}
        title="No models use this workflow"
        description={
          canEditSettings(ctx)
            ? `Assign the ${names.workflow} workflow to a model in that model's settings. Its records in the ${names.stage} stage then show here.`
            : `Records in the ${names.stage} stage show here once an administrator assigns the ${names.workflow} workflow to a model.`
        }
        actions={reload}
      />
    );
  }
  if (state.data.rows.length === 0) {
    return (
      <BlankSlate
        placement="area"
        titleLevel={1}
        icon={<EntryIcon name={args.menuItem.icon} />}
        title={args.title}
        description={`Records show here when they move to this stage of the ${names.workflow} workflow.`}
        actions={reload}
      />
    );
  }
  return null;
}

/** A failed load: the title bar stays, with the error in the list area */
function ErrorPane({
  title,
  names,
  error,
  onRetry,
}: {
  title: string;
  names: Names;
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <Pane
      ariaLabel="Records"
      header={
        <Toolbar>
          <Toolbar.Title level={1} help={stageHelp(names)}>
            {title}
          </Toolbar.Title>
        </Toolbar>
      }
    >
      <ListArea>
        <BlankSlate
          placement="area"
          error
          icon={<CircleExclamationIcon />}
          title="Couldn't load the records"
          code={describeError(error) ?? undefined}
          description={retryAdvice(error)}
          actions={
            <Button icon={RefreshIcon} label="Try again" onClick={onRetry} />
          }
        />
      </ListArea>
    </Pane>
  );
}

// The title bar, and the search row under it while the filter is open
function RecordsTitleBar({
  title,
  names,
  count,
  spinning,
  models,
  table,
  filter,
  busy,
  refreshing,
  onReload,
  progressText,
  onCancel,
}: {
  title: string;
  names: Names;
  count: string;
  spinning: boolean;
  models: readonly ModelSummary[];
  table: TableState;
  filter: ReturnType<typeof useFilterToolbar>;
  /** A bulk action runs */
  busy: boolean;
  refreshing: boolean;
  onReload: () => void;
  /** The progress of an action of more than one job: it replaces the spinner */
  progressText: string | undefined;
  /** Stops the jobs of the action that did not start yet */
  onCancel: () => void;
}) {
  const filtersDisabled = busy ? ACTION_RUNNING : undefined;
  return (
    <>
      <Toolbar>
        <Toolbar.Title level={1} help={stageHelp(names)}>
          {title}
        </Toolbar.Title>
        <Toolbar.Subtitle>{count}</Toolbar.Subtitle>
        <Toolbar.Spinner show={spinning && !progressText} />
        <Toolbar.Space />
        <Toolbar.Group>
          {models.length > 1 && (
            <FilterDropdown
              tooltip="Filter by model"
              value={table.modelId ?? ''}
              options={[
                { label: 'All models', value: '' },
                ...models.map((model) => ({
                  label: model.name,
                  value: model.id,
                })),
              ]}
              disabled={filtersDisabled}
              onChange={(value) => table.setModelId(value || null)}
            />
          )}
          <FilterDropdown
            tooltip="Filter by status"
            value={table.status ?? ''}
            options={STATUS_FILTER_OPTIONS}
            disabled={filtersDisabled}
            onChange={(value) =>
              table.setStatus((value as PublicationStatus) || null)
            }
          />
          <Toolbar.FilterToggle
            pressed={filter.open}
            // Closing the filter clears the search: not while an action runs
            onClick={filter.open && busy ? ignore : filter.onToggle}
            onOpen={filter.onOpen}
          />
        </Toolbar.Group>
        {progressText && (
          <>
            <Toolbar.Note>
              <span role="status">{progressText}</span>
            </Toolbar.Note>
            <Toolbar.Button label="Stop" onClick={onCancel} />
          </>
        )}
        <Toolbar.Button
          iconOnly
          icon={RefreshIcon}
          label="Reload records"
          onClick={onReload}
          disabled={
            busy
              ? ACTION_RUNNING
              : refreshing
                ? { reason: 'The records are loading.' }
                : undefined
          }
        />
      </Toolbar>
      {filter.open && (
        <Toolbar fields onClose={filter.onClose}>
          <Toolbar.FilterInput
            value={table.query}
            onChange={table.setQuery}
            autoFocus={filter.autoFocus}
            onClose={filter.onClose}
            disabled={busy}
          />
        </Toolbar>
      )}
    </>
  );
}

// The buttons of the selection bar. The plain actions change the selection;
// the main actions on it are primary, with Delete last. An action that does
// not apply to any selected record does not show. While an action runs, its
// own button shows a spinner and the others say why they wait.
function selectionBarActions(args: {
  bulk: BulkActions;
  table: TableState;
  refreshing: boolean;
  moveMenu: ReactElement | null;
}): (MaybeAction | MaybeAction[])[] {
  const { bulk, table } = args;
  const waitReason = bulk.busyAction
    ? ACTION_RUNNING
    : args.refreshing
      ? RECORDS_LOADING
      : undefined;
  const disabled = (id: BusyAction) =>
    bulk.busyAction === id ? undefined : waitReason;
  const mainAction = (id: SelectionAction, label: string): MaybeAction => {
    const run = bulk.actions[id];
    return (
      run && {
        id,
        tone: 'primary',
        label,
        disabled: disabled(id),
        onClick: run,
      }
    );
  };

  return [
    [
      bulk.selectAllMatching && {
        id: 'selectAllMatching',
        // "matching" only while a search or a filter narrows the records
        label: {
          id: table.filtering
            ? 'stageViewer.selectAllMatching'
            : 'stageViewer.selectAll',
          values: { count: table.matchingRows.length },
        },
        disabled: waitReason,
        onClick: bulk.selectAllMatching,
      },
      {
        id: 'toggleSelection',
        label: bulk.showingSelected ? 'Hide selection' : 'Show selection',
        disabled: waitReason,
        onClick: () => {
          table.resetSelectionPage();
          bulk.toggleShowingSelected();
        },
      },
      {
        id: 'invert',
        label: 'Invert selection',
        disabled: waitReason,
        onClick: bulk.invertPage,
      },
    ],
    mainAction('publish', 'Publish'),
    mainAction('unpublish', 'Unpublish'),
    // The menu shows no spinner of its own: it waits like the others
    args.moveMenu !== null && {
      id: 'move',
      tone: 'primary',
      label: 'Move to stage',
      disabled: waitReason,
      menu: args.moveMenu,
    },
    mainAction('delete', 'Delete'),
  ];
}

function toTableRecord(
  ctx: RenderPageCtx,
  row: RecordRow,
  thumbnails: ThumbnailMap,
): TableRecord {
  return {
    id: row.id,
    title: row.title,
    imageUrl: row.imageUploadId ? thumbnails.get(row.imageUploadId) : null,
    model: row.modelName,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status],
    updatedAt: row.updatedAt || null,
    createdAt: row.createdAt || null,
    publishedValid: row.publishedValid,
    currentValid: row.currentValid,
    draftModeActive: row.draftModeActive,
    url: recordEditorPath(ctx, row.modelId, row.id),
  };
}

// Move to stage, while the selection may go to another stage: a menu of the
// stages, which it loads when it opens
function moveMenuOf(
  bulk: BulkActions,
  client: Client | null,
  workflowId: string,
): ReactElement | null {
  if (!bulk.canMove || !client) return null;
  return (
    <MoveToStageMenu
      client={client}
      workflowId={workflowId}
      selectionInput={bulk.selectionInput}
      onPick={(stage) => {
        void bulk.moveToStage(stage);
      }}
    />
  );
}

/** The records of the stage: the title bar, the table, its pages and the selection bar */
function RecordsPane({
  ctx,
  menuItem,
  title,
  names,
  models,
  table,
  bulk,
  client,
  columns,
  onColumnsChange,
  rows,
  refreshing,
  onReload,
}: {
  ctx: RenderPageCtx;
  menuItem: StageMenuItem;
  title: string;
  names: Names;
  models: readonly ModelSummary[];
  table: TableState;
  bulk: BulkActions;
  client: Client | null;
  columns: readonly ColumnSetting[];
  onColumnsChange: (columns: readonly ColumnSetting[]) => void;
  /** The rows of the current page */
  rows: readonly TableRecord[];
  refreshing: boolean;
  onReload: () => void;
}) {
  const filter = useFilterToolbar({
    isFiltering: table.query !== '',
    onClear: () => table.setQuery(''),
  });
  const busy = bulk.busyAction !== null;
  // Sorting, pages and selection wait while the records reload or an action runs
  const enabled = !(refreshing || busy);

  return (
    <Pane
      ariaLabel="Records"
      header={
        <RecordsTitleBar
          title={title}
          names={names}
          // The listed records: the matching ones, or the selected ones
          count={formatRecordCount(ctx.ui.locale, table.displayedRows.length)}
          spinning={refreshing || busy}
          models={models}
          table={table}
          filter={filter}
          busy={busy}
          refreshing={refreshing}
          onReload={onReload}
          progressText={bulk.progressText}
          onCancel={bulk.onCancel}
        />
      }
      footer={
        // Hidden while everything fits on one default-sized page. A larger
        // page size keeps it, so its select can switch back.
        table.displayedRows.length >
          Math.min(table.perPage, DEFAULT_PER_PAGE) && (
          <Toolbar>
            <Toolbar.Pagination
              currentPage={table.page}
              perPage={table.perPage}
              totalEntries={table.displayedRows.length}
              disabled={!enabled}
              onChange={table.goToPage}
              perPageSelect={{
                options: PER_PAGE_SELECT_OPTIONS,
                onChange: table.setPerPage,
              }}
            />
          </Toolbar>
        )
      }
      slideUpToolbar={
        <MultipleSelectionActionBar
          open={bulk.selectedCount > 0}
          status={{
            id: 'stageViewer.selected',
            values: { count: bulk.selectedCount },
          }}
          onDeselectAll={() => {
            if (!busy) bulk.clear();
          }}
          actions={selectionBarActions({
            bulk,
            table,
            refreshing,
            moveMenu: moveMenuOf(bulk, client, menuItem.workflowId),
          })}
        />
      }
    >
      <ListArea>
        {table.filtering &&
        !bulk.showingSelected &&
        table.matchingRows.length === 0 ? (
          <Pane.FilterBlankSlate />
        ) : (
          <RecordsTable
            columns={columns}
            onColumnsChange={onColumnsChange}
            rows={rows}
            selectedIds={bulk.selectedIds}
            orderBy={table.orderBy}
            sortableColumnIds={table.sortableColumnIds}
            sortingEnabled={enabled}
            onOrderByChange={table.setOrderBy}
            selectionEnabled={enabled}
            onToggleRow={(id) => {
              const row = table.pageRows.find(
                (candidate) => candidate.id === id,
              );
              if (row) bulk.toggleRow(row);
            }}
            onTogglePage={bulk.togglePage}
          />
        )}
      </ListArea>
    </Pane>
  );
}

function StageView({
  ctx,
  menuItem,
}: {
  ctx: RenderPageCtx;
  menuItem: StageMenuItem;
}) {
  const { state, reload } = useStageData(ctx, menuItem);
  const data = state.status === 'ready' ? state.data : null;
  const rows = data?.rows ?? NO_ROWS;
  const models = useMemo(
    () => (data?.models ?? []).map(modelSummary),
    [data?.models],
  );
  const selection = useSelectionState();
  const table = useTableState(
    rows,
    models.map((model) => model.id),
    {
      ids: selection.selectedIds,
      showing: selection.showingSelected,
      hide: () => selection.setShowingSelected(false),
    },
  );

  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const getClient = useCallback(
    () =>
      ctxRef.current.currentUserAccessToken
        ? buildCmaClient(ctxRef.current)
        : null,
    [],
  );
  // The client of the move menu, which loads the stages when it opens
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
  const bulk = useBulkActions({
    ctx,
    selection,
    rows: data ? rows : null,
    pageRows: table.pageRows,
    matchingRows: table.matchingRows,
    models,
    stageId: menuItem.stageId,
    workflowId: menuItem.workflowId,
    stages: data?.workflow?.stages ?? null,
    getClient,
    reload,
  });
  const thumbnails = useThumbnails(
    () => buildCmaClient(ctxRef.current),
    data,
    table.pageRows.flatMap((row) =>
      row.imageUploadId ? [row.imageUploadId] : [],
    ),
  );
  const [columns, setColumns] = useColumnSettings(
    columnSettingsStorageKey({
      siteId: ctx.site.id,
      environment: ctx.environment,
      userId: ctx.currentUser.id,
    }),
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: pageRows is a new slice of displayedRows on each render
  const tableRows = useMemo(
    () => table.pageRows.map((row) => toTableRecord(ctx, row, thumbnails)),
    [
      table.displayedRows,
      table.page,
      table.perPage,
      thumbnails,
      ctx.environment,
      ctx.isEnvironmentPrimary,
    ],
  );

  const { names, title } = stageHeading(menuItem, data);
  const blankSlate = stageBlankSlate({
    ctx,
    state,
    menuItem,
    names,
    title,
    onReload: reload,
  });

  return (
    <Main className={s.layout} ref={table.bodyRef}>
      {blankSlate ??
        (state.status === 'error' ? (
          <ErrorPane
            title={title}
            names={names}
            error={state.error}
            onRetry={reload}
          />
        ) : (
          <RecordsPane
            ctx={ctx}
            menuItem={menuItem}
            title={title}
            names={names}
            models={models}
            table={table}
            bulk={bulk}
            client={client}
            columns={columns}
            onColumnsChange={setColumns}
            rows={tableRows}
            refreshing={state.status === 'ready' && state.refreshing}
            onReload={reload}
          />
        ))}
    </Main>
  );
}

export default function StagePage({ ctx, menuItem }: Props) {
  return (
    <Canvas ctx={ctx} noAutoResizer texts={TEXTS}>
      {menuItem ? (
        <StageView key={menuItem.id} ctx={ctx} menuItem={menuItem} />
      ) : (
        <UnknownStagePage ctx={ctx} />
      )}
    </Canvas>
  );
}
