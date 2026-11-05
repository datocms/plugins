import {
  DisclosureChevron,
  DisclosureChevronPlaceholder,
} from 'datocms-react-ui/Chevron';
import FeedbackDot, {
  type FeedbackDotProps,
} from 'datocms-react-ui/FeedbackDot';
import RawButton from 'datocms-react-ui/RawButton';
import Spinner from 'datocms-react-ui/Spinner';
import { useId } from 'react';
import {
  type ActivityStep,
  buildActivityView,
} from '../../lib/activityPresentation';
import type { ProcessTrace } from '../../lib/processTrace';
import { useFormatters } from '../../utils/format';
import s from './Transcript.module.css';

type Props = {
  trace?: ProcessTrace;
  open?: boolean;
  onToggle?: () => void;
};

const STEP_TONES: Record<
  Exclude<ActivityStep['state'], 'current'>,
  FeedbackDotProps['tone']
> = {
  done: 'success',
  error: 'danger',
  waiting: 'warning',
  stopped: 'neutral',
};

function stepMeta(step: ActivityStep): string {
  if (step.state === 'current') return 'In progress';
  if (step.state === 'waiting') return 'Waiting';
  if (step.state === 'error') return 'Needs attention';
  if (step.state === 'stopped') return 'Stopped';
  return 'Completed';
}

function StepItem({ step }: { step: ActivityStep }) {
  return (
    <li className={s.step}>
      <span className={s.stepMark}>
        {step.state === 'current' ? (
          <Spinner inline label={false} />
        ) : (
          <FeedbackDot tone={STEP_TONES[step.state]} />
        )}
      </span>
      <span className={s.stepLabel}>
        {step.label}
        <span className="visually-hidden">: {stepMeta(step)}</span>
      </span>
    </li>
  );
}

/**
 * A turn that stopped before it finished a step has no activity line: its
 * card (an approval) or its message (an error) tells where it stopped
 */
export function hasActivityLine(trace: ProcessTrace): boolean {
  return (
    trace.status === 'running' ||
    buildActivityView(trace).visibleSteps.some((step) => step.state === 'done')
  );
}

/**
 * The project activity of a reply, behind a disclosure: the summary tells
 * the current step while the turn runs (with a spinner), else how many
 * steps it finished, and the panel lists the steps with their state. A turn
 * that waits for an approval, failed or stopped tells it in its card or its
 * message, not here. While the turn runs, the panel lists only the steps
 * before the current one, which the summary already tells. A line whose
 * panel would tell nothing more than its summary is plain text, with a
 * placeholder in place of the chevron.
 */
export function ActivityTrace({ trace, open = false, onToggle }: Props) {
  const panelId = useId();
  const { steps } = useFormatters();

  if (!trace || !hasActivityLine(trace)) return null;

  const activity = buildActivityView(trace);
  const running = trace.status === 'running';
  const summary = running ? activity.currentStep : steps(activity.stepCount);
  const listedSteps = running
    ? activity.visibleSteps.filter((step) => step.state !== 'current')
    : activity.visibleSteps;
  const expandable = listedSteps.some((step) => step.label !== summary);

  const line = (
    <>
      {running ? <Spinner inline label={false} /> : null}
      <span className={s.disclosureTitle}>{activity.title}</span>{' '}
      <span
        className={s.activitySummary}
        aria-live={running ? 'polite' : undefined}
      >
        {summary}
      </span>
      <span className="visually-hidden"> ({activity.statusText})</span>
    </>
  );

  if (!expandable) {
    return (
      <div className={s.activity}>
        <p className={s.activityLine}>
          <DisclosureChevronPlaceholder />
          {line}
        </p>
      </div>
    );
  }

  return (
    <div className={s.activity}>
      <RawButton
        className={s.disclosure}
        expandable={{ open, controls: panelId }}
        onClick={onToggle}
      >
        <DisclosureChevron open={open} />
        {line}
      </RawButton>
      <div id={panelId} hidden={!open}>
        {open ? (
          <ol className={s.steps}>
            {listedSteps.map((step) => (
              <StepItem key={step.id} step={step} />
            ))}
          </ol>
        ) : null}
      </div>
    </div>
  );
}
