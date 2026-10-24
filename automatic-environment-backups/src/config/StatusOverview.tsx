import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import Link from 'datocms-react-ui/Link';
import { Page } from 'datocms-react-ui/Page';
import Pill from 'datocms-react-ui/Pill';
import SettingsList from 'datocms-react-ui/SettingsList';
import Spinner from 'datocms-react-ui/Spinner';
import type { BackupOverviewRow } from '../types/types';
import {
  getCadenceLabel,
  normalizeBackupScheduleConfig,
} from '../utils/backupSchedule';
import { buildBackupOverviewRows } from '../utils/buildBackupOverviewRows';
import { hasStoredBackupSchedule } from './pluginParams';
import styles from './StepContent.module.css';
import {
  type BackupsConfig,
  BUSY_REASON,
  READ_ONLY_REASON,
} from './useBackupsConfig';

const getBackupNowReason = (config: BackupsConfig) => {
  if (!config.canEdit) {
    return READ_ONLY_REASON;
  }
  return !config.canBackupNow || config.backupNowInFlightCadence !== null
    ? BUSY_REASON
    : undefined;
};

const BackupRow = ({
  row,
  config,
}: {
  row: BackupOverviewRow;
  config: BackupsConfig;
}) => {
  const isRowBusy = config.backupNowInFlightCadence === row.scope;
  const reason = isRowBusy ? undefined : getBackupNowReason(config);

  return (
    <SettingsList.Row
      title={getCadenceLabel(row.scope)}
      description={
        <>
          <div>
            Last: {row.lastBackup} · Next: {row.nextBackup}
          </div>
          {row.environmentStatusNote && <div>{row.environmentStatusNote}</div>}
        </>
      }
      value={
        row.environmentLinked ? (
          <Link to={config.environmentsPath}>{row.environmentName}</Link>
        ) : (
          row.environmentName
        )
      }
      action={
        <Button
          tone="ghost"
          label="Back up now"
          busy={isRowBusy}
          onClick={() => {
            void config.backupNow(row.scope);
          }}
          disabled={reason ? { reason } : false}
        />
      }
    />
  );
};

/** Operational view shown once a backup schedule has been saved. */
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
    progressMessage,
  } = config;

  if (!hasStoredBackupSchedule(params)) {
    return null;
  }

  const scheduleConfig = normalizeBackupScheduleConfig({
    value: params?.backupSchedule,
    timezoneFallback: projectTimezone,
  }).config;
  const overviewRows = buildBackupOverviewRows({
    scheduleConfig,
    lambdaStatus: lambdaBackupStatus,
    availableEnvironmentIds,
  });

  return (
    <Page.Group
      title="Backup status"
      status={
        isConfiguredAndReady ? (
          <Pill tone="success">Active</Pill>
        ) : (
          <Pill tone="warning">Needs attention</Pill>
        )
      }
      footer={
        isConfiguredAndReady
          ? 'The service checks the schedule daily at 02:05 UTC.'
          : undefined
      }
    >
      {!isConfiguredAndReady && (
        <Callout tone="warning">Finish the setup steps above.</Callout>
      )}
      {isConnected && progressMessage && (
        <div className={styles.block}>
          <Spinner inline label={false} /> {progressMessage}
        </div>
      )}
      {isConnected && overviewError && (
        <Callout tone="danger">{overviewError}</Callout>
      )}
      {isConnected &&
        isLoadingOverview &&
        !progressMessage &&
        !lambdaBackupStatus && (
          <BlankSlate
            placement="inline"
            small
            loading
            title="Loading backup status"
          />
        )}
      {isConnected && lambdaBackupStatus && (
        <SettingsList>
          {overviewRows.map((row) => (
            <BackupRow key={row.scope} row={row} config={config} />
          ))}
        </SettingsList>
      )}
    </Page.Group>
  );
};
