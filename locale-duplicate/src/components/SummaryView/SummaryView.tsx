import Callout from 'datocms-react-ui/Callout';
import InfoList from 'datocms-react-ui/InfoList';
import { Page } from 'datocms-react-ui/Page';
import Pane from 'datocms-react-ui/Pane';
import {
  Table,
  type TableColumn,
  useInMemoryTableLayout,
} from 'datocms-react-ui/Table';
import Toolbar from 'datocms-react-ui/Toolbar';
import { useMemo, useState } from 'react';
import type {
  DuplicationStats,
  ModelStats,
} from '../../services/duplicationTypes';
import type { Formatters } from '../../utils/format';
import { LogTable } from '../LogTable';
import type { ProgressUpdate } from '../ProgressView/ProgressView';
import { pageTitle } from '../pageTitle';

const MODELS_PER_PAGE = 100;

type ModelRow = [modelId: string, stats: ModelStats];

const MODEL_COLUMNS: TableColumn<ModelRow>[] = [
  { name: 'model', label: 'Model', renderCell: ([, stats]) => stats.name },
  {
    name: 'success',
    label: 'Successful',
    renderCell: ([, stats]) => stats.success,
  },
  { name: 'error', label: 'Failed', renderCell: ([, stats]) => stats.error },
  { name: 'total', label: 'Total', renderCell: ([, stats]) => stats.total },
];

const MODEL_LAYOUT = {
  columns: [
    { name: 'model', width: 3 },
    { name: 'success', width: 1 },
    { name: 'error', width: 1 },
    { name: 'total', width: 1 },
  ],
};

interface SummaryViewProps {
  duplicationStats: DuplicationStats;
  progressUpdates: ProgressUpdate[];
  errorUpdates: ProgressUpdate[];
  errorCount: number;
  operationCount: number;
  format: Formatters;
  onReturn: () => void;
}

export function SummaryView({
  duplicationStats: stats,
  progressUpdates,
  errorUpdates,
  errorCount,
  operationCount,
  format,
  onReturn,
}: SummaryViewProps) {
  const [modelsOpen, setModelsOpen] = useState(false);
  const [errorsOpen, setErrorsOpen] = useState(true);
  const [logOpen, setLogOpen] = useState(false);
  const [modelPage, setModelPage] = useState(0);
  const [modelLayout, setModelLayout] = useInMemoryTableLayout(MODEL_LAYOUT);
  const modelEntries = useMemo(
    () => Object.entries(stats.modelStats),
    [stats.modelStats],
  );
  const summaryErrorCount = Math.max(errorCount, errorUpdates.length);
  const visibleErrors = errorUpdates.slice(0, 100);
  const visibleOperations = progressUpdates.slice(-500);
  const publications =
    stats.publishedRecords +
    stats.failedPublications +
    stats.pendingPublications;
  const notProcessed = stats.totalToProcess - stats.totalRecords;

  return (
    <Pane
      header={
        <Pane.Header>
          {pageTitle}
          <Pane.Header.Button>
            <Toolbar.Button
              tone="primary"
              label="New duplication"
              onClick={onReturn}
            />
          </Pane.Header.Button>
        </Pane.Header>
      }
    >
      <Page variant="large">
        <Page.Content>
          <OutcomeCallout
            stats={stats}
            errorCount={summaryErrorCount}
            format={format}
          />
          <Page.Group title="Results">
            <InfoList>
              <InfoList.Row title="Records processed">
                {format.count(stats.totalRecords)}
              </InfoList.Row>
              <InfoList.Row title="Successful">
                {`${format.count(stats.successfulRecords)} (${format.percent(recordPercentage(stats.successfulRecords, stats.totalRecords))})`}
              </InfoList.Row>
              <InfoList.Row title="Failed">
                {`${format.count(stats.failedRecords)} (${format.percent(recordPercentage(stats.failedRecords, stats.totalRecords))})`}
              </InfoList.Row>
              {stats.skippedRecords > 0 && (
                <InfoList.Row title="No changes needed">
                  {format.count(stats.skippedRecords)}
                </InfoList.Row>
              )}
              {notProcessed > 0 && (
                <InfoList.Row title="Not processed">
                  {format.count(notProcessed)}
                </InfoList.Row>
              )}
              <InfoList.Row title="Models">
                {format.count(stats.totalModels)}
              </InfoList.Row>
              {stats.modelFailures > 0 && (
                <InfoList.Row title="Model or operation failures">
                  {format.count(stats.modelFailures)}
                </InfoList.Row>
              )}
              {publications > 0 && (
                <>
                  <InfoList.Row title="Published">
                    {format.count(stats.publishedRecords)}
                  </InfoList.Row>
                  <InfoList.Row title="Publication failures">
                    {format.count(stats.failedPublications)}
                  </InfoList.Row>
                  <InfoList.Row title="Pending publication">
                    {format.count(stats.pendingPublications)}
                  </InfoList.Row>
                </>
              )}
              <InfoList.Row title="Duration">
                {format.duration(stats.endTime - stats.startTime)}
              </InfoList.Row>
            </InfoList>
          </Page.Group>
          {modelEntries.length > 0 && (
            <Page.Group
              title="Models"
              flush
              collapse={{
                open: modelsOpen,
                onToggle: () => setModelsOpen(!modelsOpen),
              }}
              footer={
                modelEntries.length > MODELS_PER_PAGE ? (
                  <Toolbar.Pagination
                    ariaLabel="Models"
                    perPage={MODELS_PER_PAGE}
                    currentPage={modelPage}
                    totalEntries={modelEntries.length}
                    onChange={setModelPage}
                  />
                ) : undefined
              }
            >
              <Table
                columns={MODEL_COLUMNS}
                layout={modelLayout}
                onLayoutChange={setModelLayout}
              >
                <Table.Header />
                <Table.Body>
                  {modelEntries
                    .slice(
                      modelPage * MODELS_PER_PAGE,
                      (modelPage + 1) * MODELS_PER_PAGE,
                    )
                    .map((entry) => (
                      <Table.Row key={entry[0]} row={entry} />
                    ))}
                </Table.Body>
              </Table>
            </Page.Group>
          )}
          {summaryErrorCount > 0 && (
            <Page.Group
              title="Errors"
              flush
              collapse={{
                open: errorsOpen,
                onToggle: () => setErrorsOpen(!errorsOpen),
              }}
              footer={
                summaryErrorCount > visibleErrors.length
                  ? `Showing the first ${format.count(visibleErrors.length)} of ${format.errors(summaryErrorCount)}`
                  : format.errors(summaryErrorCount)
              }
            >
              <LogTable entries={visibleErrors} />
            </Page.Group>
          )}
          {operationCount > 0 && (
            <Page.Group
              title="Log"
              flush
              collapse={{ open: logOpen, onToggle: () => setLogOpen(!logOpen) }}
              footer={
                operationCount > visibleOperations.length
                  ? `Showing the latest ${format.count(visibleOperations.length)} of ${format.operations(operationCount)}`
                  : format.operations(operationCount)
              }
            >
              <LogTable entries={visibleOperations} />
            </Page.Group>
          )}
        </Page.Content>
      </Page>
    </Pane>
  );
}

function recordPercentage(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

export function completedWithoutErrors(
  stats: DuplicationStats,
  errorCount: number,
): boolean {
  const failures =
    stats.failedRecords +
    stats.failedPublications +
    stats.pendingPublications +
    stats.modelFailures;
  return (
    !stats.cancelled &&
    errorCount === 0 &&
    failures === 0 &&
    stats.totalRecords >= stats.totalToProcess
  );
}

function OutcomeCallout({
  stats,
  errorCount,
  format,
}: {
  stats: DuplicationStats;
  errorCount: number;
  format: Formatters;
}) {
  if (stats.cancelled) {
    return (
      <Callout tone="warning" title="Duplication stopped">
        Records updated before you stopped keep the new content. The others
        weren't changed.
      </Callout>
    );
  }
  if (completedWithoutErrors(stats, errorCount)) {
    return (
      <Callout tone="success" title="Duplication complete">
        {`Processed ${format.records(stats.totalRecords)} across ${format.models(stats.totalModels)} in ${format.duration(stats.endTime - stats.startTime)}.`}
      </Callout>
    );
  }
  return (
    <Callout tone="danger" title="Duplication finished with errors">
      Some records or models weren't duplicated. Check the errors below.
    </Callout>
  );
}
