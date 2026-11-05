import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import CardList from 'datocms-react-ui/CardList';
import EntityRow from 'datocms-react-ui/EntityRow';
import Link from 'datocms-react-ui/Link';
import { Page } from 'datocms-react-ui/Page';
import Pill from 'datocms-react-ui/Pill';
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
    <CardList.Item
      row={{
        summary: (
          <EntityRow layout="row" title={getCadenceLabel(row.scope)}>
            Last: {row.lastBackup} · Next: {row.nextBackup}
          </EntityRow>
        ),
        trailing: row.environmentLinked ? (
          <Link to={config.environmentsPath}>{row.environmentName}</Link>
        ) : (
          row.environmentName
        ),
        actions: (
          <Button
            tone="ghost"
            label="Back up now"
            busy={isRowBusy}
            onClick={() => {
              void config.backupNow(row.scope);
            }}
            disabled={reason ? { reason } : false}
          />
        ),
      }}
      body={row.environmentStatusNote}
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
    <Page.Section>
      <Page.SectionTitle>
        Backup status{' '}
        {isConfiguredAndReady ? (
          <Pill tone="success">Active</Pill>
        ) : (
          <Pill tone="warning">Needs attention</Pill>
        )}
      </Page.SectionTitle>
      {isConfiguredAndReady ? (
        <Page.SectionDescription>
          The service checks the schedule daily at 02:05 UTC.
        </Page.SectionDescription>
      ) : (
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
        <CardList actionsVisibility="always">
          {overviewRows.map((row) => (
            <BackupRow key={row.scope} row={row} config={config} />
          ))}
        </CardList>
      )}
    </Page.Section>
  );
};
