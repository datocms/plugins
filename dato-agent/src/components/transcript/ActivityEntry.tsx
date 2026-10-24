import { DisclosureChevron } from 'datocms-react-ui/Chevron';
import CodeSnippet from 'datocms-react-ui/CodeSnippet';
import FeedbackDot from 'datocms-react-ui/FeedbackDot';
import RawButton from 'datocms-react-ui/RawButton';
import Spinner from 'datocms-react-ui/Spinner';
import { useId, useState } from 'react';
import type {
  AgentActivityEntry,
  AgentActivityPhase,
  AgentActivityStatus,
  AgentActivityViewModel,
} from '../AgentSurface';
import styles from './Transcript.module.css';

const ACTIVITY_LABELS: Record<AgentActivityStatus, string> = {
  pending: 'Waiting',
  running: 'In progress',
  success: 'Completed',
  error: 'Failed',
  cancelled: 'Cancelled',
};

/** The height of a step detail before it scrolls, in CSS pixels */
const DETAIL_MAX_HEIGHT = 240;

type StepMarker = 'running' | 'success' | 'warning' | 'danger' | 'neutral';

function activitiesWithStatus(
  activities: readonly AgentActivityViewModel[],
  status: AgentActivityStatus,
): AgentActivityViewModel[] {
  return activities.filter((activity) => activity.status === status);
}

function activityPresentation(entry: AgentActivityEntry): {
  summary: string;
  showSpinner: boolean;
  failed: boolean;
} {
  const { activities, phase } = entry;
  const current = activitiesWithStatus(activities, 'running').at(-1);
  const failedCount = activitiesWithStatus(activities, 'error').length;
  const cancelledCount = activitiesWithStatus(activities, 'cancelled').length;
  const completedCount = activitiesWithStatus(activities, 'success').length;
  const pendingCount = activitiesWithStatus(activities, 'pending').length;

  if (phase === 'running') {
    if (current) {
      return { summary: current.label, showSpinner: true, failed: false };
    }

    return {
      summary: failedCount > 0 ? 'Trying another approach…' : 'Working…',
      showSpinner: true,
      failed: false,
    };
  }

  if (phase === 'failed') {
    return {
      summary: 'Couldn’t complete this request',
      showSpinner: false,
      failed: true,
    };
  }

  if (phase === 'cancelled' || cancelledCount > 0) {
    return { summary: 'Stopped', showSpinner: false, failed: false };
  }

  if (phase === 'waiting' || pendingCount > 0) {
    return {
      summary: 'Waiting for approval',
      showSpinner: false,
      failed: false,
    };
  }

  if (failedCount > 0) {
    return {
      summary: 'DatoCMS activity',
      showSpinner: false,
      failed: false,
    };
  }

  return {
    summary: `${completedCount} ${
      completedCount === 1 ? 'step' : 'steps'
    } completed`,
    showSpinner: false,
    failed: false,
  };
}

function activityStatusLabel(
  activity: AgentActivityViewModel,
  phase: AgentActivityPhase,
): string {
  if (activity.timestampLabel) {
    return activity.timestampLabel;
  }

  if (activity.status !== 'error' || phase === 'failed') {
    return ACTIVITY_LABELS[activity.status];
  }

  return phase === 'running' ? 'Trying another approach' : 'Not completed';
}

/**
 * A failed step is red only when the whole turn failed: in a turn that goes
 * on (or that finished anyway) the agent recovered from it.
 */
function stepMarker(
  activity: AgentActivityViewModel,
  phase: AgentActivityPhase,
): StepMarker {
  switch (activity.status) {
    case 'running':
      return 'running';
    case 'success':
      return 'success';
    case 'error':
      return phase === 'failed' ? 'danger' : 'warning';
    default:
      return 'neutral';
  }
}

function ActivityItem({
  activity,
  phase,
}: {
  activity: AgentActivityViewModel;
  phase: AgentActivityPhase;
}) {
  const marker = stepMarker(activity, phase);

  return (
    <li className={styles.step}>
      <span className={styles.stepMarker}>
        {marker === 'running' ? (
          <Spinner inline label={false} />
        ) : (
          <FeedbackDot tone={marker} />
        )}
      </span>
      <div className={styles.stepBody}>
        <p className={styles.stepHeading}>
          <span>{activity.label}</span>
          <span className={styles.stepStatus}>
            {activityStatusLabel(activity, phase)}
          </span>
        </p>
        {activity.description && (
          <p className={styles.stepDescription}>{activity.description}</p>
        )}
        {activity.detail && (
          <CodeSnippet
            ariaLabel={`${activity.label} details`}
            code={activity.detail}
            maxHeight={DETAIL_MAX_HEIGHT}
          />
        )}
      </div>
    </li>
  );
}

/**
 * The DatoCMS work of a turn, behind one collapsed disclosure: the summary
 * tells the current step (with a spinner while it runs) or how the turn
 * ended, and the panel lists every step with its state.
 */
export function ActivityEntry({ entry }: { entry: AgentActivityEntry }) {
  const panelId = useId();
  const [open, setOpen] = useState(false);

  if (entry.activities.length === 0) {
    return entry.phase === 'running' ? (
      <div className={styles.working} role="status">
        <Spinner inline label={false} />
        <span>Working…</span>
      </div>
    ) : null;
  }

  const presentation = activityPresentation(entry);

  return (
    <div className={styles.activity}>
      <RawButton
        className={
          presentation.failed
            ? `${styles.activityToggle} ${styles.activityFailed}`
            : styles.activityToggle
        }
        expandable={{ open, controls: panelId }}
        onClick={() => setOpen((current) => !current)}
      >
        <DisclosureChevron open={open} />
        {presentation.showSpinner && <Spinner inline label={false} />}
        <span>{presentation.summary}</span>
      </RawButton>
      <div hidden={!open} id={panelId}>
        <ol className={styles.steps}>
          {entry.activities.map((activity) => (
            <ActivityItem
              activity={activity}
              key={activity.id}
              phase={entry.phase}
            />
          ))}
        </ol>
      </div>
    </div>
  );
}
