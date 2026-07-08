import { Fragment } from 'react';
import type { CSSProperties } from 'react';
import type { StepStatus, StepStatuses } from './deriveStepStatuses';

/** Node color per status, shared by the circle border/fill and its label ink. */
const NODE_COLOR: Record<StepStatus, string> = {
  ok: 'var(--color--success-soft--ink)',
  current: 'var(--color--primary)',
  error: 'var(--color--danger-soft--ink)',
  disabled: 'var(--color--ink-subtle)',
};

/** Check glyph shown inside an `ok` node (icons aren't shippable from the SDK). */
const CheckGlyph = () => (
  <svg
    width="16"
    height="16"
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

/** Cross glyph shown inside an `error` node. */
const CrossGlyph = () => (
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
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

type TimelineNode = {
  key: string;
  label: string;
  status: StepStatus;
  /** Number shown in a `disabled` setup node; the terminal node has none. */
  number?: number;
};

const CIRCLE_SIZE = 32;

const NodeCircle = ({ status, number }: { status: StepStatus; number?: number }) => {
  const color = NODE_COLOR[status];
  const isFilled = status === 'ok' || status === 'error';

  const circleStyle: CSSProperties = {
    boxSizing: 'border-box',
    width: `${CIRCLE_SIZE}px`,
    height: `${CIRCLE_SIZE}px`,
    borderRadius: '999px',
    border: `2px solid ${color}`,
    background: isFilled ? color : 'transparent',
    color: isFilled ? '#fff' : color,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 'var(--font-size-s)',
    fontWeight: 600,
    lineHeight: 1,
    flex: '0 0 auto',
  };

  return (
    <span style={circleStyle} aria-hidden="true">
      {status === 'ok' && <CheckGlyph />}
      {status === 'error' && <CrossGlyph />}
      {status === 'current' && (
        <span
          style={{
            width: '10px',
            height: '10px',
            borderRadius: '999px',
            background: color,
          }}
        />
      )}
      {status === 'disabled' && number}
    </span>
  );
};

/**
 * Horizontal progress stepper rendered above the setup accordion. Derives its
 * three setup nodes ("Secret", "Connect", "Cadence") plus a terminal node from
 * the already-computed {@link StepStatuses}. Node visuals encode status (ok
 * check / current dot / error cross / disabled number) and the connector between
 * two nodes turns green once the left node is `ok`.
 */
export const StepTimeline = ({ statuses }: { statuses: StepStatuses }) => {
  const isAllOk = statuses.currentStep === null;

  const nodes: TimelineNode[] = [
    { key: 'secret', label: 'Secret', status: statuses.secret, number: 1 },
    { key: 'connect', label: 'Connect', status: statuses.connect, number: 2 },
    { key: 'schedule', label: 'Cadence', status: statuses.schedule, number: 3 },
    {
      key: 'done',
      label: isAllOk ? 'All ok!' : 'Done',
      status: isAllOk ? 'ok' : 'disabled',
    },
  ];

  return (
    <div
      role="list"
      aria-label="Setup progress"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        flexWrap: 'wrap',
        rowGap: 'var(--spacing-s)',
        marginBottom: 'var(--spacing-l)',
      }}
    >
      {nodes.map((node, index) => (
        <Fragment key={node.key}>
          <div
            role="listitem"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 'var(--spacing-xs)',
              flex: '0 0 auto',
            }}
          >
            <NodeCircle status={node.status} number={node.number} />
            <span
              style={{
                fontSize: 'var(--font-size-xs)',
                fontWeight: 600,
                textAlign: 'center',
                color: NODE_COLOR[node.status],
              }}
            >
              {node.label}
            </span>
          </div>

          {index < nodes.length - 1 && (
            <span
              aria-hidden="true"
              style={{
                flex: '1 1 24px',
                minWidth: '16px',
                height: '2px',
                // Center the connector on the circle (32px tall, ~half = 15px).
                marginTop: `${CIRCLE_SIZE / 2 - 1}px`,
                background:
                  node.status === 'ok'
                    ? 'var(--color--success-soft--ink)'
                    : 'var(--color--border)',
              }}
            />
          )}
        </Fragment>
      ))}
    </div>
  );
};
