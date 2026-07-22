import { CaretDownIcon, CaretUpIcon, Spinner } from 'datocms-react-ui';
import { useState } from 'react';
import {
  FaCircleCheck,
  FaCircleXmark,
  FaTriangleExclamation,
} from 'react-icons/fa6';
import type { ProgressUpdate } from '../../utils/translation/ItemsDropdownUtils';

interface ProgressRowProps {
  update: ProgressUpdate;
  /** Absolute editor URL for the record, when it can be built. */
  recordUrl?: string;
}

/** Fallback status phrase when a progress update carries no explicit one. */
function defaultStatusLabel(status: ProgressUpdate['status']): string {
  if (status === 'completed') return 'Completed';
  if (status === 'completed-with-warnings') return 'Completed (with warnings)';
  if (status === 'processing') return 'Processing…';
  if (status === 'error') return 'Error';
  return '';
}

/**
 * Whether a finished row should render as "completed with warnings": either the
 * explicit bulk `completed-with-warnings` status (design §6b) or a plain
 * `completed` row that still carries warning lines (the fatal-error fallback).
 */
function isCompletedWithWarnings(
  status: ProgressUpdate['status'],
  hasWarnings: boolean,
): boolean {
  return (
    status === 'completed-with-warnings' ||
    (status === 'completed' && hasWarnings)
  );
}

/** Status glyph, using the DatoCMS FontAwesome-6 icon set. */
function StatusIcon({
  status,
  completedWithWarnings,
}: {
  status: ProgressUpdate['status'];
  completedWithWarnings: boolean;
}) {
  if (status === 'processing') return <Spinner size={16} />;
  if (completedWithWarnings)
    return <FaTriangleExclamation title="Completed with warnings" />;
  if (status === 'error') return <FaCircleXmark title="Error" />;
  if (status === 'completed') return <FaCircleCheck title="Completed" />;
  return null;
}

/**
 * One record's row in the progress list: a status icon, the record title as a
 * link to its editor, the status phrase, a " — with warnings" suffix when the
 * record raised warnings, and — for any flagged row (error or completed-with-
 * warnings) — a click-to-expand disclosure that reveals the full per-field
 * reasons inline.
 *
 * The detail is a real accordion (not a hover tooltip): long, multi-locale
 * failure lists overflow a fixed-position tooltip, and a modal can't be stacked
 * on top of the progress modal (DatoCMS renders it behind and hangs). An inline
 * panel that pushes the list down is the only affordance that scales.
 */
export function ProgressRow({ update, recordUrl }: ProgressRowProps) {
  const [expanded, setExpanded] = useState(false);

  const warnings = update.warnings ?? [];
  const hasWarnings = warnings.length > 0;
  const completedWithWarnings = isCompletedWithWarnings(
    update.status,
    hasWarnings,
  );
  const statusText =
    update.statusText ?? update.message ?? defaultStatusLabel(update.status);
  const label = update.recordLabel;
  // Any row that carries reasons is expandable — errors AND warnings.
  const canExpand = hasWarnings;

  return (
    <li
      className={`TranslationProgressModal__update-item TranslationProgressModal__update-item--${update.status}${
        completedWithWarnings
          ? ' TranslationProgressModal__update-item--warning'
          : ''
      }`}
    >
      <div className="TranslationProgressModal__row-main">
        <span className="TranslationProgressModal__update-status">
          <StatusIcon
            status={update.status}
            completedWithWarnings={completedWithWarnings}
          />
        </span>
        <span className="TranslationProgressModal__update-message">
          {label ? (
            <>
              {recordUrl ? (
                <a
                  className="TranslationProgressModal__record-link"
                  href={recordUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {label}
                </a>
              ) : (
                <span className="TranslationProgressModal__record-link">
                  {label}
                </span>
              )}
              {' — '}
              {statusText}
              {completedWithWarnings && (
                <span className="TranslationProgressModal__with-warnings">
                  {' — with warnings'}
                </span>
              )}
            </>
          ) : (
            statusText
          )}
        </span>
        {canExpand && (
          <button
            type="button"
            className="TranslationProgressModal__detail-toggle"
            aria-expanded={expanded}
            aria-label={expanded ? 'Hide details' : 'Show details'}
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? (
              <CaretUpIcon height={12} />
            ) : (
              <CaretDownIcon height={12} />
            )}
          </button>
        )}
      </div>
      {update.status === 'processing' && update.activeField && (
        <div className="TranslationProgressModal__active-field">
          <code className="TranslationProgressModal__active-field-key">
            {update.activeField.field}
          </code>
          <span className="TranslationProgressModal__active-field-src">
            {update.activeField.sourcePreview || '…'}
          </span>
          <span className="TranslationProgressModal__active-field-arrow">→</span>
          {update.activeField.targetPreview ? (
            <span className="TranslationProgressModal__active-field-tgt">
              {update.activeField.targetPreview}
            </span>
          ) : (
            <Spinner size={12} />
          )}
        </div>
      )}
      {canExpand && expanded && (
        <ul className="TranslationProgressModal__detail">
          {warnings.map((warning) => (
            <li key={warning} className="TranslationProgressModal__detail-line">
              {warning}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
