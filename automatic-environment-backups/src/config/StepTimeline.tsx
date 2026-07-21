import type { SetupStepId, StepStatuses } from './deriveStepStatuses';

const STEP_LABELS: Record<SetupStepId, string> = {
  secret: 'Create a secret',
  deploy: 'Deploy the service',
  connect: 'Test the connection',
  schedule: 'Choose a schedule',
};

const STEPS: SetupStepId[] = ['secret', 'deploy', 'connect', 'schedule'];

/** Compact progress indicator for the four-step setup flow. */
export const StepTimeline = ({ statuses }: { statuses: StepStatuses }) => {
  const completedSteps = STEPS.filter((step) => statuses[step] === 'ok').length;
  const currentStep = statuses.currentStep;
  const currentStepNumber = currentStep ? STEPS.indexOf(currentStep) + 1 : 4;
  const isComplete = currentStep === null;

  return (
    <div
      aria-label="Setup progress"
      style={{ marginBottom: 'var(--spacing-l)' }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 'var(--spacing-m)',
          marginBottom: 'var(--spacing-s)',
          fontSize: 'var(--font-size-s)',
        }}
      >
        <strong style={{ fontWeight: 'var(--font-weight-bold)' }}>
          {isComplete ? 'Setup complete' : `Step ${currentStepNumber} of 4`}
        </strong>
        <span
          style={{
            color: 'var(--color--ink-subtle)',
            textAlign: 'right',
          }}
        >
          {isComplete ? 'All steps completed' : STEP_LABELS[currentStep]}
        </span>
      </div>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={completedSteps}
        style={{
          height: '4px',
          overflow: 'hidden',
          borderRadius: '4px',
          background: 'var(--color--surface-muted)',
        }}
      >
        <span
          style={{
            display: 'block',
            width: `${(completedSteps / STEPS.length) * 100}%`,
            height: '100%',
            borderRadius: 'inherit',
            background: isComplete
              ? 'var(--color--success-soft--ink)'
              : 'var(--color--primary--surface)',
            transition: 'width 0.2s var(--material-ease)',
          }}
        />
      </div>
    </div>
  );
};
