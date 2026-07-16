import { Button, Spinner, SwitchField } from 'datocms-react-ui';
import type { CSSProperties } from 'react';
import { BACKUP_CADENCES, getCadenceLabel } from '../utils/backupSchedule';
import { StatusBox } from './StatusBox';
import { StepActionArrow } from './StepActionArrow';
import styles from './StepContent.module.css';
import type { BackupsConfig } from './useBackupsConfig';

const switchNoHintGapStyle = {
  '--spacing-s': '0',
} as CSSProperties;

/**
 * Step 4 — choose how often backups run. Saving persists the normalized backup
 * schedule and then ensures a backup environment exists for each enabled
 * cadence, reporting progress while the initial sandboxes are created.
 */
export const StepSchedule = ({
  config,
  onFinish,
}: {
  config: BackupsConfig;
  onFinish: () => void;
}) => {
  const {
    canEdit,
    cadenceSelection,
    setCadenceEnabled,
    saveSchedule,
    isSavingSchedule,
    progressMessage,
  } = config;

  const hasSelection = cadenceSelection.length > 0;

  const handleSave = async () => {
    const didSave = await saveSchedule();
    if (didSave) {
      onFinish();
    }
  };

  return (
    <>
      <div style={{ display: 'grid', gap: 'var(--spacing-s)' }}>
        {BACKUP_CADENCES.map((cadence) => (
          <div
            key={`cadence-${cadence}`}
            style={switchNoHintGapStyle}
            data-step-interactive
          >
            <SwitchField
              name={`cadence_${cadence}`}
              id={`cadence_${cadence}`}
              label={getCadenceLabel(cadence)}
              value={cadenceSelection.includes(cadence)}
              onChange={(newValue) => setCadenceEnabled(cadence, newValue)}
              switchInputProps={{
                id: `cadence_${cadence}`,
                name: `cadence_${cadence}`,
                value: cadenceSelection.includes(cadence),
                disabled: !canEdit || isSavingSchedule,
              }}
            />
          </div>
        ))}
      </div>

      {isSavingSchedule && (
        <StatusBox variant="neutral">
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--spacing-s)',
            }}
          >
            <Spinner size={20} />
            {progressMessage ?? 'Saving schedule and creating initial backups…'}
          </span>
        </StatusBox>
      )}

      <div className={styles.stepFooter}>
        <div className={styles.stepFooterPrimary}>
          <Button
            buttonType="primary"
            buttonSize="s"
            onClick={() => {
              void handleSave();
            }}
            disabled={!canEdit || isSavingSchedule || !hasSelection}
            leftIcon={isSavingSchedule ? <Spinner size={16} /> : undefined}
            rightIcon={!isSavingSchedule ? <StepActionArrow /> : undefined}
          >
            {isSavingSchedule ? 'Saving…' : 'Save schedule & finish'}
          </Button>
        </div>
      </div>
    </>
  );
};
