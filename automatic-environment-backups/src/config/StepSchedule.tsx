import { Button, Spinner, SwitchField } from 'datocms-react-ui';
import type { CSSProperties } from 'react';
import { BACKUP_CADENCES, getCadenceLabel } from '../utils/backupSchedule';
import { StatusBox } from './StatusBox';
import type { BackupsConfig } from './useBackupsConfig';

const switchNoHintGapStyle = {
  '--spacing-s': '0',
} as CSSProperties;

/**
 * Step 3 — choose how often backups run. Saving persists the normalized backup
 * schedule and then ensures a backup environment exists for each enabled
 * cadence, reporting progress while the initial sandboxes are created.
 */
export const StepSchedule = ({ config }: { config: BackupsConfig }) => {
  const {
    cadenceSelection,
    setCadenceEnabled,
    saveSchedule,
    isSavingSchedule,
    progressMessage,
  } = config;

  const hasSelection = cadenceSelection.length > 0;

  return (
    <>
      <div style={{ display: 'grid', gap: 'var(--spacing-s)' }}>
        {BACKUP_CADENCES.map((cadence) => (
          <div key={`cadence-${cadence}`} style={switchNoHintGapStyle}>
            <SwitchField
              name={`cadence_${cadence}`}
              id={`cadence_${cadence}`}
              label={getCadenceLabel(cadence)}
              value={cadenceSelection.includes(cadence)}
              onChange={(newValue) => setCadenceEnabled(cadence, newValue)}
            />
          </div>
        ))}
      </div>

      <div>
        <Button
          buttonType="primary"
          buttonSize="s"
          onClick={() => {
            void saveSchedule();
          }}
          disabled={isSavingSchedule || !hasSelection}
        >
          {isSavingSchedule ? 'Saving…' : 'Save & continue'}
        </Button>
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
    </>
  );
};
