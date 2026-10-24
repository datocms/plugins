import Button from 'datocms-react-ui/Button';
import CodeSnippet from 'datocms-react-ui/CodeSnippet';
import FeedbackDot from 'datocms-react-ui/FeedbackDot';
import { useEffect, useId, useState } from 'react';
import type { SidebarApprovalItem } from '../../lib/sidebarChatHistory';
import { InlineCode } from './InlineCode';
import s from './Transcript.module.css';

/** The height of the arguments before they scroll, in CSS pixels */
const ARGUMENTS_MAX_HEIGHT = 260;

const WAIT_REASON = 'Wait for the reply to finish.';
const PROVIDER_REASON = "The chat provider in the settings can't run changes.";

export function approvalTitle(toolName: string): string {
  if (toolName === 'upsert_and_execute_unsafe_script') {
    return 'Apply project changes?';
  }
  return 'Run project action?';
}

export function approvalSummary(toolName: string): string {
  if (toolName === 'upsert_and_execute_unsafe_script') {
    return 'This will apply changes to your project.';
  }
  return 'This will run a project action.';
}

function stringifyPreviewValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';

  try {
    const json = JSON.stringify(value, null, 2);
    return typeof json === 'string' ? json : String(value);
  } catch {
    return String(value);
  }
}

function formatJson(value: string): { text: string; valid: boolean } {
  try {
    return { text: JSON.stringify(JSON.parse(value), null, 2), valid: true };
  } catch {
    return { text: value.trim(), valid: false };
  }
}

/** The arguments of the action, pretty-printed when they are JSON */
function formatArguments(value: unknown): string {
  return formatJson(stringifyPreviewValue(value)).text;
}

/**
 * The name of the region of the arguments. A chat can ask more than once for
 * the same action, so the second one on is numbered: "Arguments of
 * upsert_record 2".
 */
function argumentsName(toolName: string, ordinal: number): string {
  const name = `Arguments of ${toolName}`;
  return ordinal > 1 ? `${name} ${ordinal}` : name;
}

type Decision = 'approve' | 'deny';

/** Why no decision can start now, or null when one can */
function lockReason(
  canDecide: boolean,
  busyElsewhere: boolean,
  submitting: boolean,
): string | null {
  if (!canDecide) return PROVIDER_REASON;
  if (busyElsewhere || submitting) return WAIT_REASON;
  return null;
}

type DecisionProps = {
  submitting: boolean;
  canDecide: boolean;
  busyElsewhere: boolean;
  onApprove: () => unknown;
  onDeny: () => unknown;
};

/**
 * Deny and Approve. The decision that submits is busy, and the other one
 * waits for it; both wait while another turn runs.
 */
function DecisionButtons({
  submitting,
  canDecide,
  busyElsewhere,
  onApprove,
  onDeny,
}: DecisionProps) {
  const [clicked, setClicked] = useState<Decision | null>(null);

  // A decision that failed puts the item back to pending: the next submit
  // (a click, or auto-approve) tells its own decision.
  useEffect(() => {
    if (!submitting) setClicked(null);
  }, [submitting]);

  // Auto-approve submits the items without a click: that is an approval
  const busyDecision: Decision | null = submitting
    ? (clicked ?? 'approve')
    : null;
  const reason = lockReason(canDecide, busyElsewhere, submitting);
  const disabledFor = (decision: Decision) =>
    busyDecision === decision || !reason ? undefined : { reason };

  const decide = (decision: Decision) => {
    setClicked(decision);
    void (decision === 'approve' ? onApprove() : onDeny());
  };

  return (
    <div className={s.decision}>
      <Button
        tone="soft"
        label="Deny"
        busy={busyDecision === 'deny'}
        disabled={disabledFor('deny')}
        onClick={() => decide('deny')}
      />
      <Button
        tone="primary"
        label="Approve"
        busy={busyDecision === 'approve'}
        disabled={disabledFor('approve')}
        onClick={() => decide('approve')}
      />
    </div>
  );
}

function Outcome({ approved }: { approved: boolean }) {
  return (
    <p className={s.approvalOutcome}>
      {approved ? (
        <>
          <FeedbackDot tone="success" /> Approved
        </>
      ) : (
        <>
          <FeedbackDot tone="neutral" /> Denied. Nothing ran.
        </>
      )}
    </p>
  );
}

type Props = {
  item: SidebarApprovalItem;
  /** The position of the item among the approvals of the same action, from 1 */
  ordinal: number;
  /** The provider of the settings can submit decisions */
  canDecide: boolean;
  /** Another turn runs, so no decision can start */
  busyElsewhere: boolean;
  onApprove: () => unknown;
  onDeny: () => unknown;
  onToggleDetails: () => void;
};

/**
 * A project action that waits for the user's decision: what it does, its
 * arguments behind "Show details", and Deny and Approve. Once decided, its
 * decision is one line with the outcome.
 */
export function ApprovalCard({
  item,
  ordinal,
  canDecide,
  busyElsewhere,
  onApprove,
  onDeny,
  onToggleDetails,
}: Props) {
  const titleId = useId();
  const detailsId = useId();
  const resolved = item.state === 'approved' || item.state === 'denied';

  const detailsToggle = (
    <Button
      tone="ghost"
      label={item.detailsOpen ? 'Hide details' : 'Show details'}
      aria-expanded={item.detailsOpen}
      aria-controls={detailsId}
      onClick={onToggleDetails}
    />
  );

  return (
    <div role="group" aria-labelledby={titleId} className={s.approval}>
      <div className={s.approvalText}>
        <p id={titleId} className={s.approvalTitle}>
          {approvalTitle(item.toolName)}
        </p>
        {resolved ? null : (
          <p className={s.approvalSummary}>
            {approvalSummary(item.toolName)} Review the details before you
            approve.
          </p>
        )}
      </div>
      <div
        id={detailsId}
        hidden={!item.detailsOpen}
        className={s.approvalDetails}
      >
        {item.detailsOpen ? (
          <>
            <p className={s.approvalTool}>
              Action <InlineCode>{item.toolName}</InlineCode>
            </p>
            <CodeSnippet
              ariaLabel={argumentsName(item.toolName, ordinal)}
              code={formatArguments(item.argumentsJson)}
              maxHeight={ARGUMENTS_MAX_HEIGHT}
            />
          </>
        ) : null}
      </div>
      {resolved ? (
        <div className={s.approvalActions}>
          <Outcome approved={item.state === 'approved'} />
          {detailsToggle}
        </div>
      ) : (
        <div className={s.approvalActions}>
          {detailsToggle}
          <DecisionButtons
            submitting={item.state === 'submitting'}
            canDecide={canDecide}
            busyElsewhere={busyElsewhere}
            onApprove={onApprove}
            onDeny={onDeny}
          />
        </div>
      )}
    </div>
  );
}
