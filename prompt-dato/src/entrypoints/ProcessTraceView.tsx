import {
  buildActivityView,
  type ActivityStep,
} from '../lib/activityPresentation';
import type { ProcessTrace } from '../lib/processTrace';
import s from './styles.module.css';

type Props = {
  trace?: ProcessTrace;
  open?: boolean;
  onToggle?: () => void;
};

export function ProcessTraceView({
  trace,
  open = false,
  onToggle,
}: Props) {
  if (!trace) return null;

  const activity = buildActivityView(trace);
  const running = trace.status === 'running';
  const waiting = trace.status === 'waiting';
  const failed = trace.status === 'failed';
  const interrupted = trace.status === 'interrupted';
  const compactSummary =
    running || waiting || failed || interrupted
      ? activity.currentStep
      : `${activity.stepCount} ${activity.stepCount === 1 ? 'step' : 'steps'} · ${activity.duration}`;

  return (
    <div className={s.processTrace}>
      <button
        type="button"
        className={`${s.processToggle} ${running ? s.processToggleRunning : ''}`}
        onClick={onToggle}
        aria-expanded={open}
        aria-busy={running}
        aria-label={`${activity.title}: ${compactSummary} (${activity.statusText})`}
      >
        <span className={s.processCaret} aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span className={s.processTitle}>{activity.title}</span>
        <span className={s.processSummary} aria-live={running ? 'polite' : undefined}>
          {compactSummary}
        </span>
      </button>
      {open ? (
        <div
          className={`${s.processPanel} ${running ? s.processPanelRunning : ''}`}
        >
          <div className={s.processEntries}>
            {activity.visibleSteps.map((step) => (
              <ActivityStepView key={step.id} step={step} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ActivityStepView({ step }: { step: ActivityStep }) {
  return (
    <div
      className={`${s.processEntry} ${stepClassName(step.state)}`}
      aria-label={`${step.label}: ${stepMeta(step)}`}
    >
      <div className={s.processEntryHead}>
        <div className={s.processEntryMain}>
          <div className={s.processEntryTitleRow}>
            <span className={s.processStepIcon} aria-hidden="true">
              {iconForStep(step.state)}
            </span>
            <div className={s.processEntryTitle}>{step.label}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function stepClassName(state: ActivityStep['state']): string {
  if (state === 'current') return s.processEntryCurrent;
  if (state === 'done') return s.processEntryDone;
  if (state === 'error') return s.processEntryError;
  if (state === 'waiting') return s.processEntryWaiting;
  return s.processEntryStopped;
}

function iconForStep(state: ActivityStep['state']): string {
  if (state === 'done') return '✓';
  if (state === 'error') return '!';
  if (state === 'waiting') return '…';
  if (state === 'stopped') return '–';
  return '';
}

function stepMeta(step: ActivityStep): string {
  if (step.state === 'current') return 'In progress';
  if (step.state === 'waiting') return 'Waiting';
  if (step.state === 'error') return 'Needs attention';
  if (step.state === 'stopped') return 'Stopped';
  return 'Completed';
}
