import { Spinner } from 'datocms-react-ui';
import { type ReactNode, useRef, useState } from 'react';
import { BsExclamationTriangleFill } from 'react-icons/bs';
import type { ProgressUpdate } from '../../utils/translation/ItemsDropdownUtils';

interface ProgressRowProps {
  update: ProgressUpdate;
  /** Absolute editor URL for the record, when it can be built. */
  recordUrl?: string;
}

/** Fallback status phrase when a progress update carries no explicit one. */
function defaultStatusLabel(status: ProgressUpdate['status']): string {
  if (status === 'completed') return 'Completed';
  if (status === 'processing') return 'Processing…';
  if (status === 'error') return 'Error';
  return '';
}

function renderStatusIcon(
  status: ProgressUpdate['status'],
  hasWarnings: boolean,
): ReactNode {
  if (status === 'completed') {
    return hasWarnings ? (
      <BsExclamationTriangleFill
        className="TranslationProgressModal__warning-icon"
        aria-label="Completed with warnings"
      />
    ) : (
      '✓'
    );
  }
  if (status === 'processing') return <Spinner size={16} />;
  if (status === 'error') return '✗';
  return null;
}

function renderMessage(
  label: string | undefined,
  recordUrl: string | undefined,
  statusText: string,
  isCompletedWithWarnings: boolean,
): ReactNode {
  if (!label) return statusText;

  const recordLabel = recordUrl ? (
    <a
      className="TranslationProgressModal__record-link"
      href={recordUrl}
      target="_blank"
      rel="noreferrer noopener"
    >
      {label}
    </a>
  ) : (
    <span className="TranslationProgressModal__record-link">{label}</span>
  );

  return (
    <>
      {recordLabel}
      {' — '}
      {statusText}
      {isCompletedWithWarnings && (
        <span className="TranslationProgressModal__with-warnings">
          {' — with warnings'}
        </span>
      )}
    </>
  );
}

/**
 * One record's row in the progress list: a status icon, the record title as a
 * link to its editor, the status phrase, a " — with warnings" suffix when the
 * record raised warnings, and a hover tooltip carrying the warning detail.
 *
 * The tooltip is rendered with `position: fixed` at coordinates measured from
 * the row on hover/focus, so it escapes the surrounding scroll container
 * instead of being clipped by it. Records without a label (e.g. a fatal
 * top-level error) fall back to the status text alone.
 */
export function ProgressRow({ update, recordUrl }: ProgressRowProps) {
  const rowRef = useRef<HTMLLIElement>(null);
  const [tooltipPos, setTooltipPos] = useState<{
    top: number;
    left: number;
  } | null>(null);

  const hasWarnings = (update.warnings?.length ?? 0) > 0;
  const isCompletedWithWarnings = update.status === 'completed' && hasWarnings;
  const statusText =
    update.statusText ?? update.message ?? defaultStatusLabel(update.status);
  const label = update.recordLabel;

  const showTooltip = () => {
    if (!hasWarnings || !rowRef.current) return;
    const rect = rowRef.current.getBoundingClientRect();
    setTooltipPos({ top: rect.bottom + 4, left: rect.left + 24 });
  };
  const hideTooltip = () => setTooltipPos(null);

  return (
    <li
      ref={rowRef}
      className={`TranslationProgressModal__update-item TranslationProgressModal__update-item--${update.status}${
        isCompletedWithWarnings
          ? ' TranslationProgressModal__update-item--warning'
          : ''
      }`}
      // When a warned row has no focusable link (no record URL), make the row
      // itself focusable so keyboard users can reveal the tooltip too.
      tabIndex={hasWarnings && !recordUrl ? 0 : undefined}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
    >
      <span className="TranslationProgressModal__update-status">
        {renderStatusIcon(update.status, hasWarnings)}
      </span>
      <span className="TranslationProgressModal__update-message">
        {renderMessage(label, recordUrl, statusText, isCompletedWithWarnings)}
      </span>
      {hasWarnings && tooltipPos && (
        <span
          className="TranslationProgressModal__tooltip"
          role="tooltip"
          style={{ top: tooltipPos.top, left: tooltipPos.left }}
        >
          {(update.warnings ?? []).map((warning) => (
            <span
              key={warning}
              className="TranslationProgressModal__tooltip-line"
            >
              {warning}
            </span>
          ))}
        </span>
      )}
    </li>
  );
}
