import SidebarPanel from 'datocms-react-ui/SidebarPanel';
import Spinner from 'datocms-react-ui/Spinner';
import { countLabel } from '../report/format';
import { countStatuses } from '../report/view';
import type { ScanReport } from '../types';
import styles from './Panel.module.css';

const SAVING = {
  reason: "You can't check links while the record is being saved.",
};

type PanelControlsProps = {
  running: boolean;
  submitting: boolean;
  hasReport: boolean;
  onCheck: () => void;
  onCancel: () => void;
};

/**
 * The panel's one action, above the results, so it doesn't move while they
 * stream in: the small action of a panel, its text in line with the content
 * below it as far as its focus ring stays in the frame (see the CSS module).
 * It stays the same button while its label changes, so the focus stays on it
 * when a check starts or ends.
 */
export function PanelControls({
  running,
  submitting,
  hasReport,
  onCheck,
  onCancel,
}: PanelControlsProps) {
  return (
    <div className={styles.action}>
      <SidebarPanel.Action
        label={
          running ? 'Cancel check' : hasReport ? 'Check again' : 'Check links'
        }
        disabled={!running && submitting ? SAVING : undefined}
        onClick={running ? onCancel : onCheck}
      />
    </div>
  );
}

/**
 * One status line while a check runs: the inline spinner before the text of
 * the state, which already says that the check runs. The spinner is a block
 * element, so the line is a <div>, not a <p>.
 */
export function PanelProgress({
  report,
  uiLocale,
}: {
  report: ScanReport;
  uiLocale: string;
}) {
  const counts = countStatuses(report.groups);
  return (
    <div>
      <Spinner inline label={false} />{' '}
      {report.discovering
        ? 'Reading the record…'
        : countLabel(
            counts.queued + counts.checking,
            'Checking URLs (1 left)…',
            'Checking URLs ({n} left)…',
            uiLocale,
          )}
    </div>
  );
}
