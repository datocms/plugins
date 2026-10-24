import BlankSlate from 'datocms-react-ui/BlankSlate';
import Callout from 'datocms-react-ui/Callout';
import { Page } from 'datocms-react-ui/Page';
import Pane from 'datocms-react-ui/Pane';
import ProgressBar from 'datocms-react-ui/ProgressBar';
import Spinner from 'datocms-react-ui/Spinner';
import Toolbar from 'datocms-react-ui/Toolbar';
import type { DuplicationProgress } from '../../services/duplicationTypes';
import type { Formatters } from '../../utils/format';
import { LogTable } from '../LogTable';
import { pageTitle } from '../pageTitle';
import s from './ProgressView.module.css';

/**
 * Structure describing a single progress update event.
 */
export type ProgressUpdate = DuplicationProgress;

interface ProgressViewProps {
  progressUpdates: ProgressUpdate[];
  progressPercentage: number;
  operationCount: number;
  isAborting: boolean;
  sourceLocale: string;
  targetLocale: string;
  format: Formatters;
  getLocaleLabel: (locale: string) => string;
  onAbort: () => void;
}

export function ProgressView({
  progressUpdates,
  progressPercentage,
  operationCount,
  isAborting,
  sourceLocale,
  targetLocale,
  format,
  getLocaleLabel,
  onAbort,
}: ProgressViewProps) {
  const visibleUpdates = progressUpdates.slice(-500);
  const latestUpdate = progressUpdates[progressUpdates.length - 1];
  const completion = Number.isFinite(progressPercentage)
    ? Math.max(0, Math.min(100, progressPercentage))
    : 0;
  const task = `Duplicating ${getLocaleLabel(sourceLocale)} to ${getLocaleLabel(targetLocale)}`;

  return (
    <Pane
      header={
        <Pane.Header>
          {pageTitle}
          <Pane.Header.Button>
            <Toolbar.Button
              tone="soft"
              label="Stop"
              busy={isAborting}
              onClick={onAbort}
            />
          </Pane.Header.Button>
        </Pane.Header>
      }
    >
      <Page variant="large">
        <Page.Content>
          <Callout title="Keep this page open">
            Leaving the page stops the duplication after the operations in
            progress.
          </Callout>
          {latestUpdate ? (
            <Page.Group title="Progress">
              <div className={s.status} role="status" aria-live="polite">
                <Spinner inline label={false} />
                {isAborting
                  ? 'Stopping after the operations in progress'
                  : task}
                <span className={s.percent}>{format.percent(completion)}</span>
              </div>
              <ProgressBar value={completion / 100} ariaLabel={task} />
              <p className={s.message}>{latestUpdate.message}</p>
            </Page.Group>
          ) : (
            <BlankSlate
              placement="section"
              loading
              title="Starting the duplication"
            />
          )}
          {latestUpdate && (
            <Page.Group
              title="Log"
              flush
              footer={
                operationCount > visibleUpdates.length
                  ? `Showing the latest ${format.count(visibleUpdates.length)} of ${format.operations(operationCount)}`
                  : format.operations(operationCount)
              }
            >
              <LogTable entries={visibleUpdates} />
            </Page.Group>
          )}
        </Page.Content>
      </Page>
    </Pane>
  );
}
