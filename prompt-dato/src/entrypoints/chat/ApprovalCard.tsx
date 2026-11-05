import Button from 'datocms-react-ui/Button';
import { DisclosureChevron } from 'datocms-react-ui/Chevron';
import CodeSnippet from 'datocms-react-ui/CodeSnippet';
import FeedbackDot from 'datocms-react-ui/FeedbackDot';
import RawButton from 'datocms-react-ui/RawButton';
import { useEffect, useId, useState } from 'react';
import type { SidebarApprovalItem } from '../../lib/sidebarChatHistory';
import s from './Transcript.module.css';

/** The height of the arguments before they scroll, in CSS pixels */
const ARGUMENTS_MAX_HEIGHT = 260;

const WAIT_REASON = 'Wait for the reply to finish.';

function isScript(toolName: string): boolean {
  return toolName === 'upsert_and_execute_unsafe_script';
}

/**
 * A question while the user decides, and a name once the card only tells
 * the outcome. The reply above the card says what changes.
 */
function approvalTitle(toolName: string, asking: boolean): string {
  if (isScript(toolName)) {
    return asking ? 'Make these changes?' : 'Project changes';
  }
  return asking ? 'Run this action?' : 'Project action';
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
 * The name of the region of the arguments. A chat can ask for more than one
 * approval, so the second one on is numbered: "Technical details 2".
 */
function argumentsName(ordinal: number): string {
  return ordinal > 1 ? `Technical details ${ordinal}` : 'Technical details';
}

type Decision = 'approve' | 'deny';

type DecisionProps = {
  submitting: boolean;
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
  const locked = busyElsewhere || submitting;
  const disabledFor = (decision: Decision) =>
    busyDecision === decision || !locked ? undefined : { reason: WAIT_REASON };

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

/** The state of a card that asks no more: decided, or that nobody can decide */
function Outcome({
  state,
  providerLabel,
}: {
  state: 'approved' | 'denied' | 'blocked';
  providerLabel: string;
}) {
  return (
    <p className={s.approvalOutcome}>
      {state === 'approved' && (
        <>
          <FeedbackDot tone="success" /> Approved
        </>
      )}
      {state === 'denied' && (
        <>
          <FeedbackDot tone="neutral" /> Denied. Nothing changed.
        </>
      )}
      {state === 'blocked' && (
        <>
          <FeedbackDot tone="neutral" /> {providerLabel} can only read the
          project, so this change can't run.
        </>
      )}
    </p>
  );
}

type Props = {
  item: SidebarApprovalItem;
  /** The position of the item among the approvals of the chat, from 1 */
  ordinal: number;
  /** The provider of the settings can submit decisions */
  canDecide: boolean;
  /** The name of the provider of the settings: "Google" */
  providerLabel: string;
  /** Another turn runs, so no decision can start */
  busyElsewhere: boolean;
  onApprove: () => unknown;
  onDeny: () => unknown;
  onToggleDetails: () => void;
};

/**
 * A project action that waits for the user's decision: a short question
 * (the reply above says what changes), the arguments behind the "Technical
 * details" disclosure, and Deny and Approve at the bottom. Once decided, or
 * when the provider of the settings cannot decide it, the card tells the
 * outcome in one line, with the same disclosure under it.
 */
export function ApprovalCard({
  item,
  ordinal,
  canDecide,
  providerLabel,
  busyElsewhere,
  onApprove,
  onDeny,
  onToggleDetails,
}: Props) {
  const titleId = useId();
  const detailsId = useId();
  const outcome =
    item.state === 'approved' || item.state === 'denied'
      ? item.state
      : canDecide
        ? null
        : 'blocked';

  return (
    <div role="group" aria-labelledby={titleId} className={s.approval}>
      <div className={s.approvalText}>
        <p id={titleId} className={s.approvalTitle}>
          {approvalTitle(item.toolName, outcome === null)}
        </p>
        {/* While a decision submits, its busy button tells what happens */}
        {outcome ? (
          <Outcome state={outcome} providerLabel={providerLabel} />
        ) : item.state === 'submitting' ? null : (
          <p className={s.approvalSummary}>
            Nothing changes until you approve.
          </p>
        )}
      </div>
      {/* The same disclosure as the activity of a reply: the chevron before
          the title, the arguments under it */}
      <div className={s.approvalDetails}>
        <RawButton
          className={s.disclosure}
          expandable={{ open: item.detailsOpen, controls: detailsId }}
          onClick={onToggleDetails}
        >
          <DisclosureChevron open={item.detailsOpen} />
          <span className={s.disclosureTitle}>Technical details</span>
        </RawButton>
        <div id={detailsId} hidden={!item.detailsOpen}>
          {item.detailsOpen ? (
            <CodeSnippet
              ariaLabel={argumentsName(ordinal)}
              code={formatArguments(item.argumentsJson)}
              maxHeight={ARGUMENTS_MAX_HEIGHT}
            />
          ) : null}
        </div>
      </div>
      {outcome ? null : (
        <DecisionButtons
          submitting={item.state === 'submitting'}
          busyElsewhere={busyElsewhere}
          onApprove={onApprove}
          onDeny={onDeny}
        />
      )}
    </div>
  );
}
