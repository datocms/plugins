import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import type { StepStatus } from './deriveStepStatuses';
import styles from './StepSection.module.css';

type StepSectionProps = {
  stepNumber: number;
  title: string;
  description: string;
  status: StepStatus;
  isExpanded: boolean;
  onToggle: () => void;
  summary?: ReactNode;
  children: ReactNode;
};

const INTERACTIVE_CONTENT_SELECTOR = [
  'button',
  'a',
  'input',
  'textarea',
  'select',
  'label',
  '[role="button"]',
  '[contenteditable="true"]',
  '[data-step-interactive]',
].join(', ');

const CheckGlyph = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const ChevronGlyph = ({ isExpanded }: { isExpanded: boolean }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={isExpanded ? styles.chevronExpanded : styles.chevron}
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

/** Compact, accessible accordion card for one setup step. */
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
  const panelId = `setup-step-${stepNumber}-panel`;
  const headingId = `setup-step-${stepNumber}-heading`;

  const handleCardClick = (event: ReactMouseEvent<HTMLElement>) => {
    if (isDisabled || !(event.target instanceof Element)) {
      return;
    }

    if (event.target.closest(INTERACTIVE_CONTENT_SELECTOR)) {
      return;
    }

    onToggle();
  };

  return (
    <section
      className={`${styles.card} ${styles[`card_${status}`]} ${!isDisabled ? styles.cardInteractive : ''}`}
      aria-labelledby={headingId}
      onClick={handleCardClick}
    >
      <h2 className={styles.heading} id={headingId}>
        <button
          type="button"
          className={styles.header}
          onClick={isDisabled ? undefined : onToggle}
          disabled={isDisabled}
          aria-expanded={!isDisabled ? isExpanded : undefined}
          aria-controls={!isDisabled ? panelId : undefined}
        >
          <span
            aria-hidden="true"
            className={`${styles.number} ${styles[`number_${status}`]}`}
          >
            {status === 'ok' ? <CheckGlyph /> : stepNumber}
          </span>

          <span className={styles.headerCopy}>
            <span className={styles.titleRow}>
              <span className={styles.title}>{title}</span>
              {status === 'error' && (
                <span className={`${styles.badge} ${styles.badgeError}`}>
                  Needs attention
                </span>
              )}
            </span>

            {!isExpanded && (status === 'current' || status === 'error') && (
              <span className={styles.description}>{description}</span>
            )}

            {!isExpanded && status === 'ok' && summary && (
              <span className={styles.summary}>{summary}</span>
            )}
          </span>

          {!isDisabled && <ChevronGlyph isExpanded={isExpanded} />}
        </button>
      </h2>

      {!isDisabled && isExpanded && (
        <div id={panelId} className={styles.body}>
          {children}
        </div>
      )}
    </section>
  );
};
