import { Spinner } from 'datocms-react-ui';
import { countStatuses } from '../report/view';
import type { ScanReport } from '../types';
import { Button } from '../ui/Button';
import { DisabledReason } from '../ui/WithTooltip';

type PanelControlsProps = {
  running: boolean;
  submitting: boolean;
  hasReport: boolean;
  onCheck: () => void;
  onCancel: () => void;
};

/** Sits above the results, so the button doesn't move while they stream in. */
export function PanelControls({
  running,
  submitting,
  hasReport,
  onCheck,
  onCancel,
}: PanelControlsProps) {
  return running ? (
    <Button buttonSize="xs" fullWidth onClick={onCancel}>
      Cancel check
    </Button>
  ) : (
    <DisabledReason
      block
      reason={
        submitting
          ? 'You cannot check links while the record is being saved'
          : null
      }
    >
      <Button
        buttonSize="xs"
        fullWidth
        disabled={submitting}
        style={submitting ? { pointerEvents: 'none' } : undefined}
        onClick={onCheck}
      >
        {hasReport ? 'Check again' : 'Check links'}
      </Button>
    </DisabledReason>
  );
}

/** One status line while a check runs. */
export function PanelProgress({
  report,
  uiLocale,
}: {
  report: ScanReport;
  uiLocale: string;
}) {
  const counts = countStatuses(report.groups);
  const left = (counts.queued + counts.checking).toLocaleString(uiLocale);
  return (
    <div className="blc-panel-status">
      <span className="blc-spinner-box">
        <Spinner size={25} placement="centered" />
      </span>
      {report.discovering
        ? 'Reading the record…'
        : `Checking URLs (${left} left)…`}
    </div>
  );
}
