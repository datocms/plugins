import { Button } from 'datocms-react-ui';
import type { CSSProperties } from 'react';
import type { BackupOverviewRow } from '../types/types';
import { getCadenceLabel, normalizeBackupScheduleConfig } from '../utils/backupSchedule';
import { buildBackupOverviewRows } from '../utils/buildBackupOverviewRows';
import {
  buildStatusChecklist,
  type ChecklistItem,
  type ChecklistStatus,
} from './deriveStepStatuses';
import { StatusBox } from './StatusBox';
import type { BackupsConfig } from './useBackupsConfig';

const CHECKLIST_MARK: Record<ChecklistStatus, { symbol: string; color: string }> =
  {
    ok: { symbol: '✓', color: 'var(--color--success-soft--ink)' },
    error: { symbol: '✕', color: 'var(--color--danger-soft--ink)' },
    warn: { symbol: '!', color: 'var(--color--warning-soft--ink)' },
    pending: { symbol: '•', color: 'var(--color--ink-subtle)' },
  };

const rowStyle: CSSProperties = {
  border: '1px solid var(--color--border)',
  borderRadius: '6px',
  padding: 'var(--spacing-m)',
  background: 'var(--color--surface)',
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  columnGap: 'var(--spacing-m)',
  alignItems: 'center',
};

const rowInfoStyle: CSSProperties = {
  margin: 0,
  fontSize: 'var(--font-size-s)',
};

const ChecklistRow = ({ item }: { item: ChecklistItem }) => {
  const mark = CHECKLIST_MARK[item.status];
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 'var(--spacing-s)',
        fontSize: 'var(--font-size-s)',
      }}
    >
      <span aria-hidden="true" style={{ color: mark.color, fontWeight: 700 }}>
        {mark.symbol}
      </span>
      <span>
        <strong>{item.label}</strong>
        {item.detail && (
          <span style={{ color: 'var(--color--ink-subtle)' }}>
            {' '}
            — {item.detail}
          </span>
        )}
      </span>
    </div>
  );
};

/**
 * Section 4 — always-visible, read-only overview. Renders the live checklist,
 * per-cadence backup rows with [Backup now], and a summary banner. Deliberately
 * redundant with the per-step errors so a broken setup is impossible to miss.
 */
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
    lambdaBackupStatus,
    availableEnvironmentIds,
    overviewError,
    isLoadingOverview,
    backupNowInFlightCadence,
    canBackupNow,
    backupNow,
    onOpenEnvironments,
  } = config;

  const checklist = buildStatusChecklist(params, lambdaBackupStatus);
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
    <section
      style={{
        border: '1px solid var(--color--border)',
        borderRadius: '6px',
        background: 'var(--color--surface)',
        padding: 'var(--spacing-l)',
        marginBottom: 'var(--spacing-l)',
        textAlign: 'left',
      }}
    >
      <h2
        style={{
          marginTop: 0,
          marginBottom: 'var(--spacing-s)',
          fontSize: 'var(--font-size-l)',
        }}
      >
        Status overview
      </h2>

      <StatusBox
        variant={isConfiguredAndReady ? 'success' : 'warning'}
        style={{ marginBottom: 'var(--spacing-m)' }}
      >
        {isConfiguredAndReady
          ? 'Configured and ready — backups run daily at 02:05 UTC. You can leave this screen.'
          : 'Needs attention — see the highlighted step above.'}
      </StatusBox>

      <div
        style={{
          display: 'grid',
          gap: 'var(--spacing-s)',
          marginBottom: 'var(--spacing-l)',
        }}
      >
        {checklist.map((item) => (
          <ChecklistRow key={item.id} item={item} />
        ))}
      </div>

      {isLoadingOverview && (
        <p
          style={{
            margin: '0 0 var(--spacing-s)',
            color: 'var(--color--ink-subtle)',
            fontSize: 'var(--font-size-xs)',
          }}
        >
          Refreshing backup status…
        </p>
      )}

      {overviewError && (
        <StatusBox variant="error" style={{ marginBottom: 'var(--spacing-m)' }}>
          {overviewError}
        </StatusBox>
      )}

      <div style={{ display: 'grid', gap: 'var(--spacing-s)' }}>
        {overviewRows.map((row) => {
          const isRowLoading = backupNowInFlightCadence === row.scope;
          const isRowDisabled =
            !canBackupNow || backupNowInFlightCadence !== null;

          return (
            <div key={`overview-${row.scope}`} style={rowStyle}>
              <div style={{ minWidth: 0 }}>
                <h3
                  style={{
                    margin: '0 0 var(--spacing-s)',
                    fontSize: 'var(--font-size-m)',
                  }}
                >
                  {getCadenceLabel(row.scope)}
                </h3>
                <p style={rowInfoStyle}>
                  <strong>Last backup:</strong> {row.lastBackup}
                </p>
                <p style={rowInfoStyle}>
                  <strong>Next backup:</strong> {row.nextBackup}
                </p>
                <p style={rowInfoStyle}>
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
                  <p style={rowInfoStyle}>
                    <strong>Status:</strong> {row.environmentStatusNote}
                  </p>
                )}
              </div>
              <div style={{ alignSelf: 'center', minWidth: '140px' }}>
                <Button
                  buttonType="muted"
                  buttonSize="s"
                  fullWidth
                  onClick={() => {
                    void backupNow(row.scope);
                  }}
                  disabled={isRowDisabled}
                >
                  {isRowLoading ? 'Backing up…' : 'Backup now'}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
