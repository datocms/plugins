import { Spinner } from 'datocms-react-ui';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { useCallback, useEffect, useMemo } from 'react';
import { DetailPanel } from '../components/DetailPanel';
import { EnvironmentToolbar } from '../components/EnvironmentToolbar';
import { PageShell } from '../components/PageShell';
import { ResultsTable } from '../components/ResultsTable';
import { StateView } from '../components/StateView';
import { StatusFilter } from '../components/StatusFilter';
import { SummaryTable } from '../components/SummaryTable';
import { buildMediaDiff } from '../diff/media';
import { useAvailableEnvironments } from '../hooks/useAvailableEnvironments';
import { useCompareTask } from '../hooks/useCompareTask';
import { usePageQueryState } from '../hooks/usePageQueryState';
import { resolveEnvironmentPair } from '../lib/query';
import type { CompareTaskContext, FilterValue, MediaDiffRow, MediaEntityType, SummaryRow, TableColumn } from '../types';

type Props = {
  ctx: RenderPageCtx;
};

const GROUPS: MediaEntityType[] = ['upload', 'folder'];

const COLUMNS: TableColumn<MediaDiffRow>[] = [
  {
    key: 'name',
    title: 'Entity',
    render: (row) => <strong>{row.label}</strong>,
  },
  {
    key: 'location',
    title: 'Location',
    render: (row) => row.secondaryLabel ?? '—',
  },
  {
    key: 'status',
    title: 'Status',
    className: 'results-table__status',
    render: (row) => <span className={`status-chip status-chip--${row.status}`}>{row.status}</span>,
  },
  {
    key: 'changes',
    title: 'Paths',
    className: 'results-table__number',
    render: (row) => row.changedCount,
  },
];

function buildSummaryRows(summary?: Record<MediaEntityType, SummaryRow['counts']>) {
  return GROUPS.map((group) => ({
    id: group,
    label: group === 'upload' ? 'Uploads' : 'Folders',
    counts:
      summary?.[group] ?? {
        total: 0,
        changed: 0,
        leftOnly: 0,
        rightOnly: 0,
        unchanged: 0,
      },
  }));
}

export default function MediaDiffsPage({ ctx }: Props) {
  const { query, updateQuery } = usePageQueryState(ctx, 'media-diffs');
  const environments = useAvailableEnvironments(ctx);

  const resolvedPair = useMemo(
    () => resolveEnvironmentPair(environments.environmentIds, ctx.environment, query),
    [ctx.environment, environments.environmentIds, query],
  );

  useEffect(() => {
    if (!resolvedPair) {
      return;
    }

    if (query.leftEnv !== resolvedPair.leftEnv || query.rightEnv !== resolvedPair.rightEnv) {
      void updateQuery({
        leftEnv: resolvedPair.leftEnv,
        rightEnv: resolvedPair.rightEnv,
      });
    }
  }, [query.leftEnv, query.rightEnv, resolvedPair, updateQuery]);

  const activeGroup: MediaEntityType = GROUPS.includes(query.entityType as MediaEntityType)
    ? (query.entityType as MediaEntityType)
    : 'upload';

  const load = useCallback(
    (taskContext: CompareTaskContext) => {
      if (!ctx.currentUserAccessToken || !resolvedPair) {
        throw new Error('Select two environments to compare.');
      }

      return buildMediaDiff(
        ctx.currentUserAccessToken,
        resolvedPair.leftEnv,
        resolvedPair.rightEnv,
        taskContext,
      );
    },
    [ctx.currentUserAccessToken, resolvedPair],
  );

  const compare = useCompareTask(
    resolvedPair
      ? `media-diffs:${resolvedPair.leftEnv}:${resolvedPair.rightEnv}`
      : 'media-diffs:inactive',
    Boolean(resolvedPair && ctx.currentUserAccessToken),
    load,
  );

  const summaryRows = useMemo(() => buildSummaryRows(compare.data?.summary), [compare.data?.summary]);
  const filteredRows = useMemo(() => {
    const rows = compare.data?.rows ?? [];
    return rows.filter((row) => {
      const matchesGroup = row.entityType === activeGroup;
      const matchesFilter = query.filter === 'all' ? true : row.status === query.filter;
      return matchesGroup && matchesFilter;
    });
  }, [activeGroup, compare.data?.rows, query.filter]);

  const selectedDetail = query.entityId ? compare.data?.details[query.entityId] : undefined;

  const results = compare.status === 'loading' && !compare.data ? (
    <div className="loading-state">
      <Spinner size={48} />
      <p>{compare.progress.label}</p>
    </div>
  ) : compare.status === 'error' ? (
    <StateView title="Could not load media diff" message={compare.error ?? 'Unknown error'} tone="error" />
  ) : filteredRows.length === 0 ? (
    <StateView title="No matching rows" message="Try another status filter or media group." />
  ) : (
    <ResultsTable
      rows={filteredRows}
      columns={COLUMNS}
      rowId={(row) => row.id}
      selectedId={query.entityId}
      onSelect={(row) =>
        void updateQuery({
          entityType: row.entityType,
          entityId: row.id,
        })
      }
    />
  );

  if (environments.isLoading && environments.environmentIds.length === 0) {
    return (
      <PageShell
        ctx={ctx}
        title="Media area diffs"
        description="Compare folders and uploads between two environments."
        toolbar={<div />}
        summary={<div />}
        results={<div className="loading-state"><Spinner size={48} /><p>Loading environments…</p></div>}
        detail={<DetailPanel leftEnv={ctx.environment} rightEnv={ctx.environment} />}
      />
    );
  }

  if (environments.error) {
    return (
      <PageShell
        ctx={ctx}
        title="Media area diffs"
        description="Compare folders and uploads between two environments."
        toolbar={<div />}
        summary={<div />}
        results={<StateView title="Could not load environments" message={environments.error} tone="error" />}
        detail={<DetailPanel leftEnv={ctx.environment} rightEnv={ctx.environment} />}
      />
    );
  }

  if (!resolvedPair) {
    return (
      <PageShell
        ctx={ctx}
        title="Media area diffs"
        description="Compare folders and uploads between two environments."
        toolbar={<div />}
        summary={<div />}
        results={<StateView title="Add another environment" message="You need at least two environments in this project before you can run a comparison." />}
        detail={<DetailPanel leftEnv={ctx.environment} rightEnv={ctx.environment} />}
      />
    );
  }

  return (
    <PageShell
      ctx={ctx}
      title="Media area diffs"
      description="Compare upload folders, asset metadata, and folder placement between two environments."
      toolbar={
        <EnvironmentToolbar
          environments={environments.environmentIds}
          leftEnv={resolvedPair.leftEnv}
          rightEnv={resolvedPair.rightEnv}
          onLeftEnvChange={(value) => void updateQuery({ leftEnv: value, entityId: undefined })}
          onRightEnvChange={(value) => void updateQuery({ rightEnv: value, entityId: undefined })}
          onRefresh={() => void compare.refresh()}
          onCancel={compare.cancel}
          isRunning={compare.status === 'loading'}
          progress={compare.progress}
          error={compare.status === 'error' ? compare.error : undefined}
        />
      }
      summary={
        <>
          <SummaryTable
            rows={summaryRows}
            selectedId={activeGroup}
            onSelect={(id) => void updateQuery({ entityType: id, entityId: undefined })}
          />
          <StatusFilter
            value={query.filter}
            onChange={(filter: FilterValue) => void updateQuery({ filter, entityId: undefined })}
          />
        </>
      }
      results={results}
      detail={<DetailPanel detail={selectedDetail} leftEnv={resolvedPair.leftEnv} rightEnv={resolvedPair.rightEnv} />}
    />
  );
}
