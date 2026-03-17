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
import { buildContentDiff } from '../diff/content';
import { useAvailableEnvironments } from '../hooks/useAvailableEnvironments';
import { useCompareTask } from '../hooks/useCompareTask';
import { usePageQueryState } from '../hooks/usePageQueryState';
import { resolveEnvironmentPair } from '../lib/query';
import type { CompareTaskContext, ContentDiffRow, FilterValue, SummaryRow, TableColumn } from '../types';

type Props = {
  ctx: RenderPageCtx;
};

const COLUMNS: TableColumn<ContentDiffRow>[] = [
  {
    key: 'record',
    title: 'Record',
    render: (row) => <strong>{row.label}</strong>,
  },
  {
    key: 'model',
    title: 'Model',
    render: (row) => row.modelName,
  },
  {
    key: 'publication',
    title: 'Publication',
    render: (row) => row.publicationState,
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

function aggregateSummaryRows(rows: SummaryRow[]): SummaryRow[] {
  const total = rows.reduce(
    (accumulator, row) => ({
      total: accumulator.total + row.counts.total,
      changed: accumulator.changed + row.counts.changed,
      leftOnly: accumulator.leftOnly + row.counts.leftOnly,
      rightOnly: accumulator.rightOnly + row.counts.rightOnly,
      unchanged: accumulator.unchanged + row.counts.unchanged,
    }),
    { total: 0, changed: 0, leftOnly: 0, rightOnly: 0, unchanged: 0 },
  );

  return [
    {
      id: 'all',
      label: 'All models',
      description: `${rows.length} model${rows.length === 1 ? '' : 's'}`,
      counts: total,
    },
    ...rows,
  ];
}

export default function ContentDiffsPage({ ctx }: Props) {
  const { query, updateQuery } = usePageQueryState(ctx, 'content-diffs');
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

  const load = useCallback(
    (taskContext: CompareTaskContext) => {
      if (!ctx.currentUserAccessToken || !resolvedPair) {
        throw new Error('Select two environments to compare.');
      }

      return buildContentDiff(
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
      ? `content-diffs:${resolvedPair.leftEnv}:${resolvedPair.rightEnv}`
      : 'content-diffs:inactive',
    Boolean(resolvedPair && ctx.currentUserAccessToken),
    load,
  );

  const summaryRows = useMemo(
    () => aggregateSummaryRows(compare.data?.summaryRows ?? []),
    [compare.data?.summaryRows],
  );

  const activeGroup = query.entityType ?? 'all';
  const filteredRows = useMemo(() => {
    const rows = compare.data?.rows ?? [];
    return rows.filter((row) => {
      const matchesGroup = activeGroup === 'all' ? true : row.modelId === activeGroup;
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
    <StateView title="Could not load content diff" message={compare.error ?? 'Unknown error'} tone="error" />
  ) : filteredRows.length === 0 ? (
    <StateView title="No matching records" message="Try another model or status filter." />
  ) : (
    <ResultsTable
      rows={filteredRows}
      columns={COLUMNS}
      rowId={(row) => row.id}
      selectedId={query.entityId}
      onSelect={(row) =>
        void updateQuery({
          entityType: row.modelId,
          entityId: row.id,
        })
      }
    />
  );

  if (environments.isLoading && environments.environmentIds.length === 0) {
    return (
      <PageShell
        ctx={ctx}
        title="Content diffs"
        description="Compare records and field values between two environments."
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
        title="Content diffs"
        description="Compare records and field values between two environments."
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
        title="Content diffs"
        description="Compare records and field values between two environments."
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
      title="Content diffs"
      description="Compare records, publication state, localized values, and nested content between two environments."
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
