import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Button, Section, Spinner } from 'datocms-react-ui';
import type { DuplicationProgress } from '../../services/duplicationTypes';
import styles from './ProgressView.module.css';

/**
 * Structure describing a single progress update event.
 */
export type ProgressUpdate = DuplicationProgress;

const updateKeys = new WeakMap<ProgressUpdate, number>();
let nextUpdateKey = 0;

export function progressUpdateKey(update: ProgressUpdate): number {
  let key = updateKeys.get(update);
  if (key === undefined) {
    key = ++nextUpdateKey;
    updateKeys.set(update, key);
  }
  return key;
}

interface ProgressViewProps {
  ctx: RenderPageCtx;
  progressUpdates: ProgressUpdate[];
  progressPercentage: number;
  operationCount: number;
  isAborting: boolean;
  sourceLocale: string;
  targetLocale: string;
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
  getLocaleLabel,
  onAbort,
}: ProgressViewProps) {
  const visibleUpdates = progressUpdates.slice(-500);
  const latestUpdate = progressUpdates[progressUpdates.length - 1];
  const completion = Number.isFinite(progressPercentage)
    ? Math.max(0, Math.min(100, progressPercentage))
    : 0;

  return (
    <div className={styles.progressWrapper}>
      <div className={styles.progressContainer}>
        <h2 className={styles.progressHeading}>
          Duplicating content from {getLocaleLabel(sourceLocale)} to{' '}
          {getLocaleLabel(targetLocale)}
        </h2>

        <Section title="Progress Status">
          {/* Custom progress bar to show overall completion status */}
          <div className={styles.progressStatusBox}>
            {/* Progress percentage and spinner */}
            <div className={styles.progressHeader}>
              <div className={styles.progressPercentage}>
                {completion}% Complete
              </div>
              <Spinner size={24} />
            </div>

            {/* Progress bar */}
            <div className={styles.progressBarContainer}>
              <div
                className={styles.progressBar}
                style={{ width: `${completion}%` }}
              />
            </div>

            {/* Current operation description */}
            <div className={styles.currentOperation}>
              {latestUpdate?.message}
            </div>
          </div>

          {progressUpdates.length === 0 ? (
            <div className={styles.loadingContainer}>
              <Spinner size={48} />
              <div className={styles.loadingText}>
                Initializing duplication process...
              </div>
            </div>
          ) : (
            <div>
              <h3 className={styles.consoleHeader}>
                <span>Operation Console</span>
                <span className={styles.consoleCount}>
                  {operationCount} operations
                </span>
              </h3>
              {operationCount > visibleUpdates.length && (
                <p>Showing the latest {visibleUpdates.length} operations.</p>
              )}

              {/* Progress updates log */}
              <div className={styles.progressLog}>
                {visibleUpdates.map((update) => (
                  <div
                    key={progressUpdateKey(update)}
                    className={`${styles.progressItem} ${styles[update.type]}`}
                  >
                    <span className={styles.progressIcon}>
                      {update.type === 'success' && '✓'}
                      {update.type === 'error' && '✗'}
                      {update.type === 'info' && '•'}
                    </span>
                    <span className={styles.progressMessage}>
                      {update.message}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Abort button */}
          <div className={styles.abortButtonContainer}>
            <Button
              buttonType="negative"
              onClick={onAbort}
              disabled={isAborting}
            >
              {isAborting ? 'Aborting...' : 'Abort Operation'}
            </Button>
          </div>
        </Section>
      </div>
    </div>
  );
}
