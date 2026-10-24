import { DisclosureChevron } from 'datocms-react-ui/Chevron';
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
 * The project activity of a reply, behind a disclosure: the summary tells
 * the current step while the turn runs (with a spinner), or how many steps
 * it took, and the panel lists the steps with their state.
 */
export function ActivityTrace({ trace, open = false, onToggle }: Props) {
  const panelId = useId();
  const { steps } = useFormatters();

  if (!trace) return null;

  const activity = buildActivityView(trace);
  const running = trace.status === 'running';
  const showsCurrentStep =
    running ||
    trace.status === 'waiting' ||
    trace.status === 'failed' ||
    trace.status === 'interrupted';
  const summary = showsCurrentStep
    ? activity.currentStep
    : `${steps(activity.stepCount)} · ${activity.duration}`;

  return (
    <div className={s.activity}>
      <RawButton
        className={s.activityToggle}
        expandable={{ open, controls: panelId }}
        onClick={onToggle}
      >
        <DisclosureChevron open={open} />
        {running ? <Spinner inline label={false} /> : null}
        <span className={s.activityTitle}>{activity.title}</span>{' '}
        <span
          className={s.activitySummary}
          aria-live={running ? 'polite' : undefined}
        >
          {summary}
        </span>
        <span className="visually-hidden"> ({activity.statusText})</span>
      </RawButton>
      <div id={panelId} hidden={!open}>
        {open ? (
          <ol className={s.steps}>
            {activity.visibleSteps.map((step) => (
              <StepItem key={step.id} step={step} />
            ))}
          </ol>
        ) : null}
      </div>
    </div>
  );
}
