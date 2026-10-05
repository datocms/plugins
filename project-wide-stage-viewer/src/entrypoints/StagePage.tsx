import { faArrowsRotate } from '@fortawesome/free-solid-svg-icons';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import {
  Canvas,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from 'datocms-react-ui';
import { type ReactNode, useCallback, useMemo, useRef } from 'react';
import { columnSettingsStorageKey } from '../components/columnSettings';
import { FilterDropdown } from '../components/FilterDropdown';
import { Pagination } from '../components/Pagination';
import { RecordsTable } from '../components/RecordsTable';
import { SelectionActionBar } from '../components/SelectionActionBar';
import type { TableRecord } from '../components/types';
import { useColumnSettings } from '../components/useColumnSettings';
import type { StageData } from '../data/loadStage';
import {
  type BulkActions,
  useBulkActions,
  useSelectionState,
} from '../data/useBulkActions';
import { type StageDataState, useStageData } from '../data/useStageData';
import { type TableState, useTableState } from '../data/useTableState';
import { type ThumbnailMap, useThumbnails } from '../data/useThumbnails';
import {
  buildCmaClient,
  describeError,
  MissingAccessTokenError,
} from '../lib/cma';
import { formatDateTime } from '../lib/dates';
import { modelSummary, type RecordRow } from '../lib/records';
import { pluginSettingsPath, recordEditorPath } from '../lib/routes';
import type { PublicationStatus, StageMenuItem } from '../types';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import styles from './StagePage.module.css';

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

const NO_ROWS: RecordRow[] = [];

function recordsLabel(count: number): string {
  return `${count} ${count === 1 ? 'record' : 'records'}`;
}

function canEditSchema(ctx: RenderPageCtx): boolean {
  return ctx.currentRole.meta.final_permissions.can_edit_schema;
}

function SettingsButton({ ctx }: { ctx: RenderPageCtx }) {
  if (!canEditSchema(ctx)) return null;
  return (
    <Button
      onClick={() =>
        void ctx.navigateTo(pluginSettingsPath(ctx, ctx.plugin.id))
      }
    >
      Open plugin settings
    </Button>
  );
}

function ReloadButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <Tooltip placement="bottom">
      <TooltipTrigger>
        <button
          type="button"
          className={`dl-icon-button ${styles.reload}`}
          aria-label="Reload records"
          disabled={disabled}
          onClick={onClick}
        >
          <Icon icon={faArrowsRotate} />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <div className="dl-tooltip-text">Reload records</div>
      </TooltipContent>
    </Tooltip>
  );
}

function Toolbar({
  title,
  context,
  children,
}: {
  title: string;
  context?: string;
  children?: ReactNode;
}) {
  return (
    <header className={styles.toolbar}>
      <h1 className={styles.title}>{title}</h1>
      {context ? <span className={styles.context}>{context}</span> : null}
      <div className={styles.spacer} />
      {children}
    </header>
  );
}

function StateMessage({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={styles.state}>
      <h2>{title}</h2>
      <p>{children}</p>
      {action ? <div className={styles.stateActions}>{action}</div> : null}
    </div>
  );
}

/** A page whose ID doesn't match any saved entry (it was removed in the settings). */
function UnknownStagePage({ ctx }: { ctx: RenderPageCtx }) {
  return (
    <div className={styles.page}>
      <Toolbar title="Page not found" />
      <StateMessage
        title="This page is no longer available"
        action={<SettingsButton ctx={ctx} />}
      >
        Its workflow stage was removed from the plugin settings. Pick the stages
        to show in the content sidebar there.
      </StateMessage>
    </div>
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

/** The toolbar title (the sidebar label) and the workflow context after it. */
function stageHeading(menuItem: StageMenuItem, data: StageData | null) {
  const names = stageNames(menuItem, data);
  const title = menuItem.label ?? names.stage;
  const context =
    title === names.stage
      ? `${names.workflow} workflow`
      : `${names.stage} stage, ${names.workflow} workflow`;
  return { names, title, context };
}

function needsApiAccess(ctx: RenderPageCtx, state: StageDataState): boolean {
  return (
    !ctx.currentUserAccessToken ||
    (state.status === 'error' && state.error instanceof MissingAccessTokenError)
  );
}

/** States where the stage can't list records at all; null when it can. */
function configurationState(
  ctx: RenderPageCtx,
  data: StageData | null,
  names: Names,
): ReactNode {
  if (data?.stageMissing) {
    return (
      <StateMessage
        title="This stage no longer exists"
        action={<SettingsButton ctx={ctx} />}
      >
        The {names.stage} stage was removed from the {names.workflow} workflow,
        or the workflow itself was deleted. Remove this page in the plugin
        settings.
      </StateMessage>
    );
  }
  if (data && data.models.length === 0) {
    return (
      <StateMessage title="No models use this workflow">
        Assign the {names.workflow} workflow to a model in its settings, and its
        records in the {names.stage} stage will show up here.
      </StateMessage>
    );
  }
  return null;
}

function FilterBar({
  table,
  models,
  disabled,
}: {
  table: TableState;
  models: readonly { id: string; name: string }[];
  disabled: boolean;
}) {
  return (
    <div className={styles.filterBar}>
      <div className={styles.searchWrap}>
        <svg
          aria-hidden="true"
          viewBox="0 0 512 512"
          className={styles.searchIcon}
        >
          <path
            fill="currentColor"
            d="M416 208a208 208 0 1 1-416 0 208 208 0 0 1 416 0Zm-48 0a160 160 0 1 0-320 0 160 160 0 0 0 320 0Zm9.4 203.4 96 96a24 24 0 0 0 33.9-33.9l-96-96a24 24 0 0 0-33.9 33.9Z"
          />
        </svg>
        <input
          type="text"
          className={styles.search}
          aria-label="Search records"
          placeholder="Search records"
          value={table.query}
          disabled={disabled}
          onChange={(event) => table.setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && table.query) {
              event.preventDefault();
              table.setQuery('');
            }
          }}
        />
        {table.query && (
          <button
            type="button"
            className={styles.clearSearch}
            disabled={disabled}
            aria-label="Clear search"
            onClick={() => table.setQuery('')}
          >
            ×
          </button>
        )}
      </div>

      <FilterDropdown
        ariaLabel="Filter by model"
        value={table.modelId ?? ''}
        options={[
          { label: 'All models', value: '' },
          ...models.map((model) => ({ label: model.name, value: model.id })),
        ]}
        disabled={disabled}
        onChange={(value) => table.setModelId(value || null)}
      />

      <FilterDropdown
        ariaLabel="Filter by publication status"
        value={table.status ?? ''}
        options={STATUS_FILTER_OPTIONS}
        alignment="right"
        disabled={disabled}
        onChange={(value) =>
          table.setStatus((value as PublicationStatus) || null)
        }
      />
    </div>
  );
}

function toTableRecord(
  row: RecordRow,
  thumbnails: ThumbnailMap,
  locale: string,
  timeZone: string | undefined,
): TableRecord {
  return {
    id: row.id,
    title: row.title,
    imageUrl: row.imageUploadId ? thumbnails.get(row.imageUploadId) : null,
    imageAlt: '',
    model: row.modelName,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status],
    updatedAt: formatDateTime(row.updatedAt, locale, timeZone),
    createdAt: formatDateTime(row.createdAt, locale, timeZone),
    publishedValid: row.publishedValid,
    currentValid: row.currentValid,
    draftModeActive: row.draftModeActive,
  };
}

function errorState(error: unknown, onRetry: () => void): ReactNode {
  return (
    <StateMessage
      title="Could not load records"
      action={
        <button type="button" className={styles.retry} onClick={onRetry}>
          Retry
        </button>
      }
    >
      {describeError(error) ?? 'Could not load records. Please try again.'}
    </StateMessage>
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

  const { names, title, context } = stageHeading(menuItem, data);
  const loading = state.status === 'loading';
  const refreshing = state.status === 'ready' && state.refreshing;
  const busy = bulk.busyAction !== null;

  if (needsApiAccess(ctx, state)) {
    return (
      <div className={styles.page}>
        <Toolbar title={title} context={context} />
        <StateMessage title="API access required">
          Grant the Current user access token permission to this plugin, then
          reload the page.
        </StateMessage>
      </div>
    );
  }

  const configuration = configurationState(ctx, data, names);
  if (configuration) {
    return (
      <div className={styles.page}>
        <Toolbar title={title} context={context}>
          <ReloadButton onClick={reload} disabled={refreshing} />
        </Toolbar>
        {configuration}
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Toolbar title={title} context={context}>
        {data ? (
          <div className={styles.total}>
            {recordsLabel(table.matchingRows.length)}
          </div>
        ) : null}
        <ReloadButton
          onClick={reload}
          disabled={loading || refreshing || busy}
        />
      </Toolbar>

      <FilterBar table={table} models={models} disabled={busy} />

      <main className={styles.content} ref={table.bodyRef}>
        {state.status === 'error' ? (
          errorState(state.error, reload)
        ) : (
          <StageTable
            ctx={ctx}
            table={table}
            bulk={bulk}
            rows={rows}
            columns={columns}
            onColumnsChange={setColumns}
            thumbnails={thumbnails}
            loading={loading || refreshing}
            disabled={busy || loading}
          />
        )}
      </main>

      <div className={styles.slideUpToolbar}>
        <SelectionActionBar
          selectedCount={bulk.selectedCount}
          showingSelected={bulk.showingSelected}
          onToggleShowingSelected={() => {
            table.resetSelectionPage();
            bulk.toggleShowingSelected();
          }}
          onInvertSelection={bulk.invertPage}
          onClearSelection={bulk.clear}
          disabled={loading || refreshing}
          busyAction={bulk.busyAction}
          onSelectAllMatching={bulk.selectAllMatching}
          progressText={bulk.progressText}
          onCancel={bulk.onCancel}
          actions={bulk.actions}
        />
      </div>

      <Pagination
        currentPage={table.page}
        perPage={table.perPage}
        totalEntries={table.displayedRows.length}
        disabled={loading || refreshing || busy}
        onPageChange={table.goToPage}
        onPerPageChange={table.setPerPage}
      />
    </div>
  );
}

function StageTable({
  ctx,
  table,
  bulk,
  rows,
  columns,
  onColumnsChange,
  thumbnails,
  loading,
  disabled,
}: {
  ctx: RenderPageCtx;
  table: TableState;
  bulk: BulkActions;
  rows: readonly RecordRow[];
  columns: Parameters<typeof RecordsTable>[0]['columns'];
  onColumnsChange: Parameters<typeof RecordsTable>[0]['onColumnsChange'];
  thumbnails: ThumbnailMap;
  loading: boolean;
  disabled: boolean;
}) {
  const timeZone = ctx.site.attributes.timezone ?? undefined;
  const byId = new Map(table.pageRows.map((row) => [row.id, row]));

  return (
    <RecordsTable
      columns={columns}
      sortableColumnIds={table.sortableColumnIds}
      rows={table.pageRows.map((row) =>
        toTableRecord(row, thumbnails, ctx.ui.locale, timeZone),
      )}
      selectedIds={bulk.selectedIds}
      orderBy={table.orderBy}
      onColumnsChange={onColumnsChange}
      onOrderByChange={table.setOrderBy}
      onToggleRow={(id) => {
        const row = byId.get(id);
        if (row) bulk.toggleRow(row);
      }}
      onTogglePage={bulk.togglePage}
      onOpenRow={(record) => {
        const row = byId.get(record.id);
        if (row) {
          void ctx.navigateTo(recordEditorPath(ctx, row.modelId, row.id));
        }
      }}
      loading={loading}
      disabled={disabled}
      emptyState={
        rows.length > 0 && table.filtering
          ? 'No records match the current filters.'
          : 'No records in this stage.'
      }
    />
  );
}

export default function StagePage({ ctx, menuItem }: Props) {
  return (
    <Canvas ctx={ctx} noAutoResizer>
      {menuItem ? (
        <StageView key={menuItem.id} ctx={ctx} menuItem={menuItem} />
      ) : (
        <UnknownStagePage ctx={ctx} />
      )}
    </Canvas>
  );
}
