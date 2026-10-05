import { Button, Section } from 'datocms-react-ui';
import { useCallback, useMemo, useState } from 'react';
import type { DuplicationStats } from '../../services/duplicationTypes';
import {
  type ProgressUpdate,
  progressUpdateKey,
} from '../ProgressView/ProgressView';
import styles from './SummaryView.module.css';

/**
 * Represents statistics for the duplication process
 */
interface SummaryViewProps {
  duplicationStats: DuplicationStats;
  progressUpdates: ProgressUpdate[];
  errorUpdates: ProgressUpdate[];
  errorCount: number;
  operationCount: number;
  onReturn: () => void;
}

interface ExpandedSections {
  models: boolean;
  fields: boolean;
  errors: boolean;
  logs: boolean;
}

export function SummaryView({
  duplicationStats,
  progressUpdates,
  errorUpdates,
  errorCount,
  operationCount,
  onReturn,
}: SummaryViewProps) {
  const [expandedSections, setExpandedSections] = useState<ExpandedSections>({
    models: false,
    fields: false,
    errors: false,
    logs: false,
  });
  const summaryErrorCount = Math.max(errorCount, errorUpdates.length);
  const visibleErrors = errorUpdates.slice(0, 100);
  const visibleOperations = progressUpdates.slice(-500);

  const toggleSection = useCallback((section: keyof ExpandedSections) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  }, []);

  return (
    <div className={styles.summaryContainer}>
      <div className={styles.summaryContent}>
        <h2 className={styles.summaryTitle}>
          Duplication Summary
          <span className={styles.summaryTitleUnderline} />
        </h2>

        {/* Duplication Statistics Section */}
        <Section title="Duplication Statistics">
          <div className={styles.statsContainer}>
            {/* Records Processed */}
            <button
              type="button"
              onClick={() => toggleSection('models')}
              aria-expanded={expandedSections.models}
              className={`${styles.expandableButton} ${expandedSections.models ? styles.expanded : ''}`}
            >
              <div className={styles.buttonLeft}>
                <span className={styles.buttonIcon}>📝</span>
                <span className={styles.buttonLabel}>Records Processed</span>
              </div>
              <div className={styles.buttonRight}>
                <span className={styles.buttonValue}>
                  {duplicationStats.totalRecords}
                </span>
                <span
                  className={`${styles.expandIcon} ${expandedSections.models ? styles.expanded : ''}`}
                >
                  ▾
                </span>
              </div>
            </button>

            {expandedSections.models && (
              <RecordStatistics duplicationStats={duplicationStats} />
            )}

            {/* Errors */}
            {summaryErrorCount > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => toggleSection('errors')}
                  aria-expanded={expandedSections.errors}
                  className={`${styles.expandableButton} ${styles.errorButton} ${expandedSections.errors ? styles.expanded : ''}`}
                >
                  <div className={styles.buttonLeft}>
                    <span className={styles.buttonIcon}>⚠️</span>
                    <span className={`${styles.buttonLabel} ${styles.error}`}>
                      Errors Encountered
                    </span>
                  </div>
                  <div className={styles.buttonRight}>
                    <span className={`${styles.buttonValue} ${styles.error}`}>
                      {summaryErrorCount}
                    </span>
                    <span
                      className={`${styles.expandIcon} ${expandedSections.errors ? styles.expanded : ''}`}
                    >
                      ▾
                    </span>
                  </div>
                </button>

                {expandedSections.errors && (
                  <div className={styles.expandedContent}>
                    {summaryErrorCount > visibleErrors.length && (
                      <p>Showing the first {visibleErrors.length} errors.</p>
                    )}
                    <div className={styles.errorLog}>
                      {visibleErrors.map((error) => (
                        <div
                          key={progressUpdateKey(error)}
                          className={styles.errorItem}
                        >
                          <span className={styles.errorIcon}>✗</span>
                          <span>{error.message}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Full Operation Log */}
            <button
              type="button"
              onClick={() => toggleSection('logs')}
              aria-expanded={expandedSections.logs}
              className={`${styles.expandableButton} ${expandedSections.logs ? styles.expanded : ''}`}
            >
              <div className={styles.buttonLeft}>
                <span className={styles.buttonIcon}>📋</span>
                <span className={styles.buttonLabel}>Full Operation Log</span>
              </div>
              <div className={styles.buttonRight}>
                <span className={`${styles.buttonValue} ${styles.muted}`}>
                  {operationCount} entries
                </span>
                <span
                  className={`${styles.expandIcon} ${expandedSections.logs ? styles.expanded : ''}`}
                >
                  ▾
                </span>
              </div>
            </button>

            {expandedSections.logs && (
              <div className={styles.expandedContent}>
                {operationCount > visibleOperations.length && (
                  <p>
                    Showing the latest {visibleOperations.length} operations.
                  </p>
                )}
                <div className={styles.fullLog}>
                  {visibleOperations.map((update) => (
                    <div
                      key={progressUpdateKey(update)}
                      className={`${styles.logItem} ${styles[update.type]}`}
                    >
                      <span className={styles.logIcon}>
                        {update.type === 'success' && '✓'}
                        {update.type === 'error' && '✗'}
                        {update.type === 'info' && '•'}
                      </span>
                      <span className={styles.logMessage}>
                        {update.message}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <OverallSummary
            duplicationStats={duplicationStats}
            errorCount={summaryErrorCount}
          />
        </Section>

        {/* Return button */}
        <div className={styles.returnButtonContainer}>
          <Button
            fullWidth
            buttonType="primary"
            buttonSize="l"
            onClick={onReturn}
          >
            Return to Duplication Screen
          </Button>
        </div>
      </div>
    </div>
  );
}

export function RecordStatistics({
  duplicationStats,
}: {
  duplicationStats: DuplicationStats;
}) {
  const [modelPage, setModelPage] = useState(0);
  const modelStatsEntries = useMemo(
    () => Object.entries(duplicationStats.modelStats),
    [duplicationStats.modelStats],
  );
  const successPercentage = recordPercentage(
    duplicationStats.successfulRecords,
    duplicationStats.totalRecords,
  );
  const failedPercentage = recordPercentage(
    duplicationStats.failedRecords,
    duplicationStats.totalRecords,
  );
  return (
    <div className={styles.expandedContent}>
      <h4 className={styles.subheading}>Record Statistics</h4>

      <table className={styles.statsTable}>
        <thead>
          <tr>
            <th>Status</th>
            <th>Count</th>
            <th>Percentage</th>
          </tr>
        </thead>
        <tbody>
          <tr className={styles.successRow}>
            <td>✓ Successful</td>
            <td>{duplicationStats.successfulRecords}</td>
            <td>{successPercentage}%</td>
          </tr>
          <tr className={styles.errorRow}>
            <td>✗ Failed</td>
            <td>{duplicationStats.failedRecords}</td>
            <td>{failedPercentage}%</td>
          </tr>
        </tbody>
      </table>

      <h4 className={`${styles.subheading} ${styles.spaced}`}>
        Models Processed
      </h4>
      <table className={styles.statsTable}>
        <thead>
          <tr>
            <th>Model</th>
            <th>Success</th>
            <th>Failed</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {modelStatsEntries
            .slice(modelPage * 100, (modelPage + 1) * 100)
            .map(([modelId, stats]) => (
              <tr key={modelId}>
                <td>{stats.name}</td>
                <td className={styles.successText}>{stats.success}</td>
                <td className={stats.error > 0 ? styles.errorText : ''}>
                  {stats.error}
                </td>
                <td>{stats.total}</td>
              </tr>
            ))}
        </tbody>
      </table>
      {modelStatsEntries.length > 100 && (
        <div>
          <Button
            disabled={modelPage === 0}
            onClick={() => setModelPage((page) => page - 1)}
          >
            Previous models
          </Button>
          <span>
            {' '}
            Page {modelPage + 1} of {Math.ceil(
              modelStatsEntries.length / 100,
            )}{' '}
          </span>
          <Button
            disabled={(modelPage + 1) * 100 >= modelStatsEntries.length}
            onClick={() => setModelPage((page) => page + 1)}
          >
            Next models
          </Button>
        </div>
      )}
    </div>
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

function summaryTitle(
  stats: DuplicationStats,
  completedSuccessfully: boolean,
): string {
  if (stats.cancelled) return 'Duplication Aborted';
  return completedSuccessfully
    ? '✓ Duplication Completed Successfully!'
    : '⚠️ Duplication Completed with Errors';
}

export function OverallSummary({
  duplicationStats,
  errorCount,
}: {
  duplicationStats: DuplicationStats;
  errorCount: number;
}) {
  const completedSuccessfully = completedWithoutErrors(
    duplicationStats,
    errorCount,
  );
  const duration = Math.max(
    0,
    duplicationStats.endTime - duplicationStats.startTime,
  );
  const durationMinutes = Math.floor(duration / 60000);
  const durationSeconds = Math.floor((duration % 60000) / 1000);
  return (
    <div
      className={`${styles.overallSummary} ${completedSuccessfully ? styles.success : styles.error}`}
    >
      <h3
        className={`${styles.overallTitle} ${completedSuccessfully ? styles.success : styles.error}`}
      >
        {summaryTitle(duplicationStats, completedSuccessfully)}
      </h3>
      <p className={styles.overallDescription}>
        Processed {duplicationStats.totalRecords} records across{' '}
        {duplicationStats.totalModels} models in {durationMinutes}m{' '}
        {durationSeconds}s
      </p>
      {duplicationStats.skippedRecords > 0 && (
        <p>{duplicationStats.skippedRecords} records needed no changes.</p>
      )}
      {duplicationStats.totalRecords < duplicationStats.totalToProcess && (
        <p>
          {duplicationStats.totalToProcess - duplicationStats.totalRecords}{' '}
          selected records were not processed.
        </p>
      )}
      {duplicationStats.modelFailures > 0 && (
        <p>
          {duplicationStats.modelFailures} model or operation failures prevented
          a complete run.
        </p>
      )}
      {duplicationStats.publishedRecords +
        duplicationStats.failedPublications +
        duplicationStats.pendingPublications >
        0 && (
        <p>
          {duplicationStats.publishedRecords} records published;{' '}
          {duplicationStats.failedPublications} publication failures;{' '}
          {duplicationStats.pendingPublications} pending.
        </p>
      )}
    </div>
  );
}
