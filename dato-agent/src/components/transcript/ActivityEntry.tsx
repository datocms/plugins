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
  success: 'Done',
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

function stepCount(count: number) {
  return `${count} ${count === 1 ? 'step' : 'steps'}`;
}

/**
 * The summary of the activity: the current step while it runs, else only the
 * number of steps. How the turn ended is said once, by the answer, the error
 * or the change card under the activity.
 */
function activityPresentation(entry: AgentActivityEntry): {
  summary: string;
  showSpinner: boolean;
} {
  const { activities, phase } = entry;
  const current = activitiesWithStatus(activities, 'running').at(-1);
  const failedCount = activitiesWithStatus(activities, 'error').length;
  const cancelledCount = activitiesWithStatus(activities, 'cancelled').length;

  if (phase === 'running') {
    if (current) {
      return { summary: current.label, showSpinner: true };
    }

    return {
      summary: failedCount > 0 ? 'Trying another approach…' : 'Working…',
      showSpinner: true,
    };
  }

  if (phase === 'cancelled' || cancelledCount > 0) {
    return { summary: 'Stopped', showSpinner: false };
  }

  return { summary: stepCount(activities.length), showSpinner: false };
}

/** The state of a step, in words next to its dot */
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
  const statusLabel = activityStatusLabel(activity, phase);
  const [detailOpen, setDetailOpen] = useState(false);
  const detailId = useId();

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
          <span className={styles.stepStatus}>{statusLabel}</span>
        </p>
        {activity.description && (
          <p className={styles.stepDescription}>{activity.description}</p>
        )}
        {/* The request or the error of the step is technical: it waits
            behind a disclosure, as the code of a change */}
        {activity.detail && (
          <>
            <RawButton
              // Which step, for a screen reader that lists the buttons
              ariaLabel={`Show the details of ${activity.label}`}
              className={styles.stepToggle}
              expandable={{ open: detailOpen, controls: detailId }}
              onClick={() => setDetailOpen((open) => !open)}
            >
              <DisclosureChevron open={detailOpen} />
              Show the details
            </RawButton>
            <div hidden={!detailOpen} id={detailId}>
              <CodeSnippet
                ariaLabel={`${activity.label} details`}
                code={activity.detail}
                maxHeight={DETAIL_MAX_HEIGHT}
              />
            </div>
          </>
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
        className={styles.activityToggle}
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
