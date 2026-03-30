import { useState, useMemo, useCallback } from 'react';
import { Section, Button } from 'datocms-react-ui';
import type { ProgressUpdate } from '../ProgressView';
import styles from './SummaryView.module.css';

/**
 * Represents statistics for the duplication process
 */
export interface DuplicationStats {
  totalModels: number;
  totalRecords: number;
  successfulRecords: number;
  failedRecords: number;
  modelStats: Record<string, { 
    success: number;
    error: number;
    total: number;
    name: string;
    processedRecordIds: Record<string, boolean>;
  }>;
  startTime: number;
  endTime: number;
}

interface SummaryViewProps {
  duplicationStats: DuplicationStats;
  progressUpdates: ProgressUpdate[];
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
  onReturn
}: SummaryViewProps) {
  const [expandedSections, setExpandedSections] = useState<ExpandedSections>({
    models: false,
    fields: false,
    errors: false,
    logs: false
  });

  // Memoize error updates filtering
  const errorUpdates = useMemo(() => 
    progressUpdates.filter(update => update.type === 'error'), 
    [progressUpdates]
  );
  
  // Memoize success percentage calculation
  const successPercentage = useMemo(() => 
    duplicationStats.totalRecords > 0
      ? Math.round((duplicationStats.successfulRecords / duplicationStats.totalRecords) * 100)
      : 0,
    [duplicationStats.totalRecords, duplicationStats.successfulRecords]
  );
  
  // Memoize duration calculations
  const { durationMinutes, durationSeconds } = useMemo(() => {
    const duration = duplicationStats.endTime - duplicationStats.startTime;
    return {
      durationMinutes: Math.floor(duration / 60000),
      durationSeconds: Math.floor((duration % 60000) / 1000)
    };
  }, [duplicationStats.endTime, duplicationStats.startTime]);
  
  // Memoize model statistics entries
  const modelStatsEntries = useMemo(() => 
    Object.entries(duplicationStats.modelStats),
    [duplicationStats.modelStats]
  );

  const toggleSection = useCallback((section: keyof ExpandedSections) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
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
                <span className={styles.buttonLabel}>
                  Records Processed
                </span>
              </div>
              <div className={styles.buttonRight}>
                <span className={styles.buttonValue}>
                  {duplicationStats.totalRecords}
                </span>
                <span className={`${styles.expandIcon} ${expandedSections.models ? styles.expanded : ''}`}>
                  ▾
                </span>
              </div>
            </button>
            
            {/* Expanded records details */}
            {expandedSections.models && (
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
                      <td>{100 - successPercentage}%</td>
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
                    {modelStatsEntries.map(([modelId, stats]) => (
                      <tr key={modelId}>
                        <td>{stats.name}</td>
                        <td className={styles.successText}>{stats.success}</td>
                        <td className={stats.error > 0 ? styles.errorText : ''}>{stats.error}</td>
                        <td>{stats.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Errors */}
            {errorUpdates.length > 0 && (
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
                      {errorUpdates.length}
                    </span>
                    <span className={`${styles.expandIcon} ${expandedSections.errors ? styles.expanded : ''}`}>
                      ▾
                    </span>
                  </div>
                </button>

                {expandedSections.errors && (
                  <div className={styles.expandedContent}>
                    <div className={styles.errorLog}>
                      {errorUpdates.map((error, index) => (
                        <div key={`error-${index}`} className={styles.errorItem}>
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
                <span className={styles.buttonLabel}>
                  Full Operation Log
                </span>
              </div>
              <div className={styles.buttonRight}>
                <span className={`${styles.buttonValue} ${styles.muted}`}>
                  {progressUpdates.length} entries
                </span>
                <span className={`${styles.expandIcon} ${expandedSections.logs ? styles.expanded : ''}`}>
                  ▾
                </span>
              </div>
            </button>

            {expandedSections.logs && (
              <div className={styles.expandedContent}>
                <div className={styles.fullLog}>
                  {progressUpdates.map((update, index) => (
                    <div 
                      key={`log-${index}`} 
                      className={`${styles.logItem} ${styles[update.type]}`}
                    >
                      <span className={styles.logIcon}>
                        {update.type === 'success' && '✓'}
                        {update.type === 'error' && '✗'}
                        {update.type === 'info' && '•'}
                      </span>
                      <span className={styles.logMessage}>{update.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Overall Summary */}
          <div className={`${styles.overallSummary} ${successPercentage === 100 ? styles.success : styles.error}`}>
            <h3 className={`${styles.overallTitle} ${successPercentage === 100 ? styles.success : styles.error}`}>
              {successPercentage === 100 ? '✓ Duplication Completed Successfully!' : '⚠️ Duplication Completed with Errors'}
            </h3>
            <p className={styles.overallDescription}>
              Processed {duplicationStats.totalRecords} records across {duplicationStats.totalModels} models in {durationMinutes}m {durationSeconds}s
            </p>
          </div>
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