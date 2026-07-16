import { Button, Spinner } from 'datocms-react-ui';
import type { BackupOverviewRow } from '../types/types';
import {
  getCadenceLabel,
  normalizeBackupScheduleConfig,
} from '../utils/backupSchedule';
import { buildBackupOverviewRows } from '../utils/buildBackupOverviewRows';
import { hasStoredBackupSchedule } from './pluginParams';
import { StatusBox } from './StatusBox';
import styles from './StatusOverview.module.css';
import type { BackupsConfig } from './useBackupsConfig';

/** Compact operational view shown once a backup schedule has been saved. */
export const StatusOverview = ({
  config,
  isConfiguredAndReady,
}: {
  config: BackupsConfig;
  isConfiguredAndReady: boolean;
}) => {
  const {
    params,
    projectTimezone,
    isConnected,
    lambdaBackupStatus,
    availableEnvironmentIds,
    overviewError,
    isLoadingOverview,
    backupNowInFlightCadence,
    canBackupNow,
    backupNow,
    onOpenEnvironments,
  } = config;

  if (!hasStoredBackupSchedule(params)) {
    return null;
  }

  const scheduleConfig = normalizeBackupScheduleConfig({
    value: params?.backupSchedule,
    timezoneFallback: projectTimezone,
  }).config;
  const overviewRows: BackupOverviewRow[] = buildBackupOverviewRows({
    scheduleConfig,
    lambdaStatus: lambdaBackupStatus,
    availableEnvironmentIds,
  });

  return (
    <section className={styles.section}>
      <h2 className={styles.title}>Backup status</h2>

      <StatusBox
        variant={isConfiguredAndReady ? 'success' : 'warning'}
        style={{ marginBottom: 'var(--spacing-m)' }}
      >
        {isConfiguredAndReady
          ? 'Automatic backups are active. The service checks the schedule daily at 02:05 UTC.'
          : 'Setup needs attention. Fix the highlighted step above.'}
      </StatusBox>

      {isConnected && isLoadingOverview && (
        <StatusBox
          variant="neutral"
          style={{ marginBottom: 'var(--spacing-m)' }}
        >
          <span className={styles.spinnerRow}>
            <Spinner size={20} />
            Loading backup status…
          </span>
        </StatusBox>
      )}

      {isConnected && overviewError && (
        <StatusBox variant="error" style={{ marginBottom: 'var(--spacing-m)' }}>
          {overviewError}
        </StatusBox>
      )}

      {isConnected && lambdaBackupStatus && (
        <div className={styles.rows}>
          {overviewRows.map((row) => {
            const isRowLoading = backupNowInFlightCadence === row.scope;
            const isRowDisabled =
              !canBackupNow || backupNowInFlightCadence !== null;

            return (
              <div key={`overview-${row.scope}`} className={styles.row}>
                <div className={styles.rowInfo}>
                  <h3>{getCadenceLabel(row.scope)}</h3>
                  <p>
                    <strong>Last:</strong> {row.lastBackup}
                  </p>
                  <p>
                    <strong>Next:</strong> {row.nextBackup}
                  </p>
                  <p>
                    <strong>Environment:</strong>{' '}
                    {row.environmentLinked ? (
                      <a
                        href="/project_settings/environments"
                        onClick={(event) => {
                          event.preventDefault();
                          void onOpenEnvironments();
                        }}
                      >
                        {row.environmentName}
                      </a>
                    ) : (
                      row.environmentName
                    )}
                  </p>
                  {row.environmentStatusNote && (
                    <p>
                      <strong>Status:</strong> {row.environmentStatusNote}
                    </p>
                  )}
                </div>

                <Button
                  buttonType="muted"
                  buttonSize="s"
                  onClick={() => {
                    void backupNow(row.scope);
                  }}
                  disabled={isRowDisabled}
                  leftIcon={isRowLoading ? <Spinner size={16} /> : undefined}
                >
                  {isRowLoading ? 'Backing up…' : 'Backup now'}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
