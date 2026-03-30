import { Section, Spinner, Button } from 'datocms-react-ui';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import styles from './ProgressView.module.css';

/**
 * Structure describing a single progress update event.
 */
export interface ProgressUpdate {
  message: string;
  type: 'info' | 'success' | 'error';
  timestamp: number;
  progress?: number;
  modelId?: string;
  modelName?: string;
  recordId?: string;
}

interface ProgressViewProps {
  ctx: RenderPageCtx;
  progressUpdates: ProgressUpdate[];
  progressPercentage: number;
  isAborting: boolean;
  sourceLocale: string;
  targetLocale: string;
  getLocaleLabel: (locale: string) => string;
  onAbort: () => void;
}

export function ProgressView({
  progressUpdates,
  progressPercentage,
  isAborting,
  sourceLocale,
  targetLocale,
  getLocaleLabel,
  onAbort
}: ProgressViewProps) {
  const latestUpdate = progressUpdates[progressUpdates.length - 1];

  return (
    <div className={styles.progressWrapper}>
      <div className={styles.progressContainer}>
        <h2 className={styles.progressHeading}>
          Duplicating content from {getLocaleLabel(sourceLocale)} to {getLocaleLabel(targetLocale)}
        </h2>
        
        <Section title="Progress Status">
          {/* Custom progress bar to show overall completion status */}
          <div className={styles.progressStatusBox}>
            {/* Progress percentage and spinner */}
            <div className={styles.progressHeader}>
              <div className={styles.progressPercentage}>
                {progressPercentage}% Complete
              </div>
              <Spinner size={24} />
            </div>
            
            {/* Progress bar */}
            <div className={styles.progressBarContainer}>
              <div 
                className={styles.progressBar}
                style={{ width: `${progressPercentage}%` }} 
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
                  {progressUpdates.length} operations
                </span>
              </h3>
              
              {/* Progress updates log */}
              <div className={styles.progressLog}>
                {progressUpdates.map((update, index) => (
                  <div 
                    key={`${update.timestamp}-${index}`} 
                    className={`${styles.progressItem} ${styles[update.type]}`}
                  >
                    <span className={styles.progressIcon}>
                      {update.type === 'success' && '✓'}
                      {update.type === 'error' && '✗'}
                      {update.type === 'info' && '•'}
                    </span>
                    <span className={styles.progressMessage}>{update.message}</span>
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