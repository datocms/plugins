import Button from 'datocms-react-ui/Button';
import { Page, type PageCollapse } from 'datocms-react-ui/Page';
import Spinner from 'datocms-react-ui/Spinner';
import SwitchInput from 'datocms-react-ui/SwitchInput';
import SwitchList from 'datocms-react-ui/SwitchList';
import type { ReactNode } from 'react';
import { BACKUP_CADENCES, getCadenceLabel } from '../utils/backupSchedule';
import styles from './StepContent.module.css';
import {
  type BackupsConfig,
  BUSY_REASON,
  READ_ONLY_REASON,
} from './useBackupsConfig';

type Props = {
  config: BackupsConfig;
  section: { status?: ReactNode; collapse: PageCollapse };
  onFinish: () => void;
};

const getSaveReason = (config: BackupsConfig) => {
  if (!config.canEdit) {
    return READ_ONLY_REASON;
  }
  if (config.isBusy && !config.isSavingSchedule) {
    return BUSY_REASON;
  }
  return config.cadenceSelection.length > 0
    ? undefined
    : 'Turn on at least one schedule.';
};

/**
 * Step 4: choose how often backups run. Saving persists the normalized backup
 * schedule and then ensures a backup environment exists for each enabled
 * cadence, reporting progress while the initial sandboxes are created.
 */
export const StepSchedule = ({ config, section, onFinish }: Props) => {
  const {
    canEdit,
    isBusy,
    cadenceSelection,
    setCadenceEnabled,
    saveSchedule,
    isSavingSchedule,
    progressMessage,
  } = config;

  const saveReason = getSaveReason(config);

  const handleSave = async () => {
    const didSave = await saveSchedule();
    if (didSave) {
      onFinish();
    }
  };

  return (
    <Page.Section>
      <Page.SectionTitle collapse={section.collapse}>
        4. Choose a backup schedule {section.status}
      </Page.SectionTitle>
      {section.collapse.open && (
        <>
          <SwitchList className={styles.block}>
            {BACKUP_CADENCES.map((cadence) => (
              <SwitchInput
                key={cadence}
                label={getCadenceLabel(cadence)}
                value={cadenceSelection.includes(cadence)}
                onChange={(value) => setCadenceEnabled(cadence, Boolean(value))}
                disabled={!canEdit || isBusy}
              />
            ))}
          </SwitchList>
          <div className={styles.buttons}>
            <Button
              tone="primary"
              label="Save schedule & finish"
              busy={isSavingSchedule}
              onClick={() => {
                void handleSave();
              }}
              disabled={saveReason ? { reason: saveReason } : false}
            />
            {isSavingSchedule && (
              <span>
                <Spinner inline label={false} />{' '}
                {progressMessage ??
                  'Saving the schedule and creating the first backups…'}
              </span>
            )}
          </div>
        </>
      )}
    </Page.Section>
  );
};
