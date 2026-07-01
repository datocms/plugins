import { Button } from 'datocms-react-ui';
import type { CSSProperties, ReactNode } from 'react';
import type { StepStatus } from './deriveStepStatuses';

type StepSectionProps = {
  stepNumber: number;
  title: string;
  /** One-line "what & why" shown under the title. */
  description: string;
  status: StepStatus;
  isExpanded: boolean;
  onToggle: () => void;
  /** Collapsed one-line summary shown when the step is `ok`. */
  summary?: ReactNode;
  children: ReactNode;
};

type BadgeTokens = { label: string; ink: string; surface: string; border: string };

const STATUS_BADGE: Partial<Record<StepStatus, BadgeTokens>> = {
  ok: {
    label: 'OK',
    ink: 'var(--color--success-soft--ink)',
    surface: 'var(--color--success-soft--surface)',
    border: 'var(--color--success-soft--border)',
  },
  current: {
    label: 'Current step',
    ink: 'var(--color--primary, #1a56db)',
    surface: 'var(--color--light-bg, var(--color--surface))',
    border: 'var(--color--primary, #1a56db)',
  },
  error: {
    label: 'Error',
    ink: 'var(--color--danger-soft--ink)',
    surface: 'var(--color--danger-soft--surface)',
    border: 'var(--color--danger-soft--border)',
  },
};

const getNumberCircleColor = (status: StepStatus): string => {
  if (status === 'ok') {
    return 'var(--color--success-soft--ink)';
  }
  if (status === 'error') {
    return 'var(--color--danger-soft--ink)';
  }
  if (status === 'current') {
    return 'var(--color--primary, #1a56db)';
  }
  return 'var(--color--ink-subtle)';
};

/**
 * Accordion section chrome for a single setup step: numbered header, one-line
 * "what & why", a status badge, and an expand/collapse body. Driven entirely by
 * `status` and `isExpanded` from the orchestrator — a `disabled` step renders
 * grayed and non-interactive (no "locked" chrome), an `ok` step collapses to its
 * summary with an `[Edit]` affordance.
 */
export const StepSection = ({
  stepNumber,
  title,
  description,
  status,
  isExpanded,
  onToggle,
  summary,
  children,
}: StepSectionProps) => {
  const isDisabled = status === 'disabled';
  const badge = STATUS_BADGE[status];
  const numberColor = getNumberCircleColor(status);

  const cardStyle: CSSProperties = {
    border:
      status === 'current' || status === 'error'
        ? `1px solid ${numberColor}`
        : '1px solid var(--color--border)',
    borderRadius: '6px',
    background: 'var(--color--surface)',
    marginBottom: 'var(--spacing-l)',
    textAlign: 'left',
    opacity: isDisabled ? 0.55 : 1,
  };

  const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 'var(--spacing-m)',
    width: '100%',
    padding: 'var(--spacing-l)',
    border: 0,
    background: 'transparent',
    textAlign: 'left',
    cursor: isDisabled ? 'default' : 'pointer',
    font: 'inherit',
    color: 'var(--color--ink)',
  };

  const numberBadgeStyle: CSSProperties = {
    flex: '0 0 auto',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    borderRadius: '999px',
    border: `2px solid ${numberColor}`,
    color: numberColor,
    fontSize: 'var(--font-size-s)',
    fontWeight: 600,
    lineHeight: 1,
  };

  return (
    <section style={cardStyle}>
      <button
        type="button"
        onClick={isDisabled ? undefined : onToggle}
        disabled={isDisabled}
        aria-expanded={isExpanded}
        style={headerStyle}
      >
        <span aria-hidden="true" style={numberBadgeStyle}>
          {stepNumber}
        </span>
        <span style={{ flex: '1 1 auto', minWidth: 0 }}>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--spacing-s)',
              flexWrap: 'wrap',
            }}
          >
            <strong style={{ fontSize: 'var(--font-size-l)' }}>{title}</strong>
            {badge && (
              <span
                style={{
                  display: 'inline-block',
                  padding: '2px var(--spacing-s)',
                  borderRadius: '999px',
                  border: `1px solid ${badge.border}`,
                  background: badge.surface,
                  color: badge.ink,
                  fontSize: 'var(--font-size-xs)',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                {badge.label}
              </span>
            )}
          </span>
          <span
            style={{
              display: 'block',
              marginTop: 'var(--spacing-xs)',
              color: 'var(--color--ink-subtle)',
              fontSize: 'var(--font-size-s)',
              lineHeight: 1.35,
            }}
          >
            {description}
          </span>
        </span>
      </button>

      {!isDisabled && isExpanded && (
        <div
          style={{
            padding: '0 var(--spacing-l) var(--spacing-l)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--spacing-m)',
          }}
        >
          {children}
        </div>
      )}

      {!isDisabled && !isExpanded && status === 'ok' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--spacing-m)',
            padding: '0 var(--spacing-l) var(--spacing-l)',
          }}
        >
          <span
            style={{
              color: 'var(--color--ink-subtle)',
              fontSize: 'var(--font-size-s)',
              minWidth: 0,
              wordBreak: 'break-word',
            }}
          >
            {summary}
          </span>
          <Button buttonType="muted" buttonSize="s" onClick={onToggle}>
            Edit
          </Button>
        </div>
      )}
    </section>
  );
};
