/**
 * ProgressRow.tsx
 * ---------------
 * One record's row in the list of the translation progress modal: the record
 * title, its state under it (an inline spinner while it is translated, then
 * a dot and the result, with the fields that weren't translated and why, and
 * a tooltip with all of them in full, as the line can be cut), and a button
 * that opens the record in a new tab, on hover or focus. A record still in
 * progress when the run stopped on a fatal error shows as not translated,
 * without the spinner.
 */
import Button from 'datocms-react-ui/Button';
import EntityRow from 'datocms-react-ui/EntityRow';
import FeedbackDot from 'datocms-react-ui/FeedbackDot';
import RowList from 'datocms-react-ui/RowList';
import Spinner from 'datocms-react-ui/Spinner';
import Tooltip from 'datocms-react-ui/Tooltip';
import { memo, type ReactNode } from 'react';
import { OpenInNewTabIcon } from '../../icons';
import type { ProgressUpdate } from '../../utils/translation/ItemsDropdownUtils';

interface ProgressRowProps {
  update: ProgressUpdate;
  /**
   * The CMS path of the record's editor (with the environment), when the
   * link can be built.
   */
  recordPath?: string;
  /**
   * The run is over (it finished or stopped on a fatal error): a record
   * still in progress won't get further, so its row stops loading.
   */
  runEnded?: boolean;
}

/**
 * The state word of a record that the run left in progress: the word of its
 * result, like the other rows.
 */
const STOPPED_TEXT = 'Not translated';

/** Fallback state word when a progress update carries no explicit one. */
function defaultStatusText(status: ProgressUpdate['status']): string {
  if (status === 'completed') return 'Translated';
  if (status === 'error') return 'Failed';
  return 'Translating…';
}

/**
 * The state of the record in words: the status phrase of the update, then
 * its warnings, which say in full sentences which fields weren't translated
 * and why ("Translated. Excerpt wasn't translated into Italian [it]. …").
 */
function stateText(update: ProgressUpdate): string {
  const statusText = update.statusText ?? defaultStatusText(update.status);
  const warnings =
    update.status === 'processing' ? [] : (update.warnings ?? []);
  return warnings.length > 0
    ? [`${statusText}.`, ...warnings].join(' ')
    : statusText;
}

/** The mark before the state: a spinner while running, then a dot. */
function stateMark(update: ProgressUpdate): ReactNode {
  if (update.status === 'processing') {
    return <Spinner inline label={false} />;
  }
  if (update.status === 'error') return <FeedbackDot tone="danger" />;
  const hasWarnings = (update.warnings?.length ?? 0) > 0;
  return <FeedbackDot tone={hasWarnings ? 'warning' : 'success'} />;
}

/**
 * The details line of the row: the mark, then the state in words. The line
 * is cut with an ellipsis, so when the record has warnings, a tooltip on the
 * line (on hover and on keyboard focus) shows each of them in full. The line
 * keeps the same elements in every state: only the label of the tooltip
 * comes and goes.
 */
function StateLine({
  update,
  runEnded,
}: {
  update: ProgressUpdate;
  runEnded: boolean;
}) {
  const warnings =
    update.status === 'processing' ? [] : (update.warnings ?? []);
  const hasWarnings = warnings.length > 0;
  const stopped = runEnded && update.status === 'processing';

  return (
    <Tooltip
      long
      placement="bottom-start"
      label={
        hasWarnings && (
          <div>
            {warnings.map((warning) => (
              <div key={warning}>{warning}</div>
            ))}
          </div>
        )
      }
    >
      {/* Focusable only with warnings, so keyboard users can open the
          tooltip too. */}
      <span tabIndex={hasWarnings ? 0 : undefined}>
        {stopped ? (
          <>
            <FeedbackDot tone="neutral" /> {STOPPED_TEXT}
          </>
        ) : (
          <>
            {stateMark(update)} {stateText(update)}
          </>
        )}
      </span>
    </Tooltip>
  );
}

/**
 * A static row of the progress list. A record without a label falls back to
 * its ID, so every row stays unique.
 */
function BaseProgressRow({
  update,
  recordPath,
  runEnded = false,
}: ProgressRowProps) {
  return (
    <RowList.Item>
      <EntityRow
        layout="row"
        title={update.recordLabel ?? `Record ${update.recordId}`}
        trailing={
          recordPath ? (
            // A page of the CMS: `to`, in a new tab so the modal stays open.
            // It shows on hover or focus of the row (always on touch).
            <RowList.Actions>
              <Button
                tone="ghost"
                size="micro"
                iconOnly
                icon={OpenInNewTabIcon}
                label="Open the record"
                to={recordPath}
                newTab
              />
            </RowList.Actions>
          ) : undefined
        }
      >
        <StateLine update={update} runEnded={runEnded} />
      </EntityRow>
    </RowList.Item>
  );
}

/**
 * The rows re-render only when their update changes: the modal renders the
 * whole list every 100ms while a run goes on.
 */
export const ProgressRow = memo(BaseProgressRow);
