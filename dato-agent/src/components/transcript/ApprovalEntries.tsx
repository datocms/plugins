import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import { useId } from 'react';
import { EditIcon } from '../../icons';
import type { UnsafeApprovalViewModel } from '../AgentSurface';
import styles from './Transcript.module.css';

type ApprovalAction = (approval: UnsafeApprovalViewModel) => void;

const DECISION_SAVING_REASON = 'Wait for the decision to save.';
const HOST_ACTION_REASON = 'Wait for the current action to finish.';

const OUTCOME_PRESENTATION: Record<
  NonNullable<UnsafeApprovalViewModel['outcome']>['kind'],
  { title: string; description: string }
> = {
  failed_before_execution: {
    title: 'Change didn’t run',
    description: 'No project content was changed.',
  },
  failed_after_execution: {
    title: 'Change may be incomplete',
    description:
      'Some project content may have changed. Check DatoCMS before trying again.',
  },
  unknown: {
    title: 'Outcome needs checking',
    description: 'The change may have run. Check DatoCMS before trying again.',
  },
};

/** "Review details" opens the Change details modal, when there is something to review */
function ReviewDetailsButton({
  approval,
  locked,
  onReview,
}: {
  approval: UnsafeApprovalViewModel;
  locked?: boolean;
  onReview?: ApprovalAction;
}) {
  if (!(approval.details?.length || approval.script) || !onReview) {
    return null;
  }

  return (
    <Button
      aria-haspopup="dialog"
      disabled={locked ? { reason: HOST_ACTION_REASON } : undefined}
      label="Review details"
      onClick={() => onReview(approval)}
      tone="ghost"
    />
  );
}

/**
 * Deny and Approve. The decision that saves is busy and the other one waits
 * for it; both wait while another host action runs.
 */
function DecisionButtons({
  approval,
  locked,
  onApprove,
  onReject,
}: {
  approval: UnsafeApprovalViewModel;
  locked?: boolean;
  onApprove?: ApprovalAction;
  onReject?: ApprovalAction;
}) {
  const approving = approval.status === 'approving';
  const rejecting = approval.status === 'rejecting';
  const waitReason =
    approving || rejecting
      ? { reason: DECISION_SAVING_REASON }
      : locked
        ? { reason: HOST_ACTION_REASON }
        : undefined;

  // A decision that can't be sent from here doesn't show
  if (!onReject && !onApprove) {
    return null;
  }

  return (
    <div className={styles.decision}>
      {onReject && (
        <Button
          busy={rejecting}
          disabled={rejecting ? undefined : waitReason}
          label="Deny"
          onClick={() => onReject(approval)}
          tone="soft"
        />
      )}
      {onApprove && (
        <Button
          busy={approving}
          disabled={approving ? undefined : waitReason}
          label="Approve"
          onClick={() => onApprove(approval)}
          tone="primary"
        />
      )}
    </div>
  );
}

/**
 * A change that ran and failed, or whose result is not known: what happened
 * and what to check, the details, and a repair turn when one is possible.
 */
function ApprovalOutcomeEntry({
  approval,
  autoApproveEnabled,
  locked,
  onReview,
  onRepair,
}: {
  approval: UnsafeApprovalViewModel;
  autoApproveEnabled: boolean;
  locked?: boolean;
  onReview?: ApprovalAction;
  onRepair?: ApprovalAction;
}) {
  const outcome = approval.outcome;

  if (!outcome) return null;

  const presentation = OUTCOME_PRESENTATION[outcome.kind];
  const canRepair = Boolean(approval.recovery && onRepair);
  const repairStarting = approval.recovery?.status === 'starting';
  const canReview = Boolean(
    (approval.details?.length || approval.script) && onReview,
  );

  return (
    <div
      aria-label={presentation.title}
      className={styles.approvalOutcome}
      role="group"
    >
      {/* A change that failed or may be incomplete is a risk with the
          project content, as in the Change details modal */}
      <Callout
        className={styles.callout}
        title={presentation.title}
        tone="warning"
      >
        {presentation.description}
      </Callout>
      {/* What stopped the change is a fact of its own: the outcome stays
          one or two sentences */}
      {approval.error && (
        <Callout className={styles.callout} tone="danger">
          {approval.error}
        </Callout>
      )}
      {(canReview || canRepair) && (
        <div className={styles.approvalActions}>
          <ReviewDetailsButton
            approval={approval}
            locked={locked}
            onReview={onReview}
          />
          {canRepair && (
            <div className={styles.decision}>
              <Button
                busy={repairStarting}
                disabled={
                  locked && !repairStarting
                    ? { reason: HOST_ACTION_REASON }
                    : undefined
                }
                label={
                  repairStarting ? (
                    'Preparing fix…'
                  ) : autoApproveEnabled ? (
                    <>
                      Fix with Auto
                      <span className="visually-hidden">
                        . Auto is on. The corrected operation may run
                        automatically.
                      </span>
                    </>
                  ) : (
                    'Fix and review'
                  )
                }
                onClick={() => onRepair?.(approval)}
                tone="primary"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type ApprovalEntryProps = {
  approval: UnsafeApprovalViewModel;
  autoApproveEnabled: boolean;
  /** A host action runs */
  locked?: boolean;
  onReview?: ApprovalAction;
  onApprove?: ApprovalAction;
  onReject?: ApprovalAction;
  onRepair?: ApprovalAction;
};

/** A decided change: one quiet line, and its details */
function ResolvedApprovalEntry({
  approval,
  locked,
  onReview,
}: Pick<ApprovalEntryProps, 'approval' | 'locked' | 'onReview'>) {
  const resolution =
    approval.error ??
    (approval.status === 'approved'
      ? 'Approved.'
      : 'Denied. No action was taken.');

  return (
    <div
      aria-label={`${approval.title}. ${resolution}`}
      className={styles.approvalResolved}
      role="group"
    >
      <span className={styles.approvalIcon}>
        <EditIcon />
      </span>
      <p className={styles.approvalResolution} role="status">
        {resolution}
      </p>
      <ReviewDetailsButton
        approval={approval}
        locked={locked}
        onReview={onReview}
      />
    </div>
  );
}

/**
 * A change that waits for a decision, or whose decision saves or failed: the
 * change, its error, and Review details, Deny and Approve. An error that ends
 * the change leaves no decision to take.
 */
function PendingApprovalEntry({
  approval,
  locked,
  onReview,
  onApprove,
  onReject,
}: Omit<ApprovalEntryProps, 'autoApproveEnabled' | 'onRepair'>) {
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const deciding =
    approval.status === 'approving' || approval.status === 'rejecting';
  const showDecision =
    (approval.status === 'pending' || deciding) &&
    Boolean(onApprove || onReject);
  const errorMessage =
    approval.error ??
    (approval.status === 'error'
      ? 'This change could not be approved.'
      : undefined);
  const canReview = Boolean(
    (approval.details?.length || approval.script) && onReview,
  );

  return (
    <div
      aria-describedby={
        errorMessage ? `${descriptionId} ${errorId}` : descriptionId
      }
      aria-labelledby={titleId}
      className={styles.approval}
      role="group"
    >
      <div className={styles.approvalHeader}>
        <span className={styles.approvalIcon}>
          <EditIcon />
        </span>
        <div className={styles.approvalText}>
          {/* The name of the card, not a heading: the frame is no page or
              dialog, and the card is a named group */}
          <p className={styles.approvalTitle} id={titleId}>
            {approval.title}
          </p>
          <p className={styles.approvalDescription} id={descriptionId}>
            {approval.description}
          </p>
        </div>
      </div>
      {errorMessage && (
        <div id={errorId}>
          <Callout className={styles.callout} tone="danger">
            {errorMessage}
          </Callout>
        </div>
      )}
      {(canReview || showDecision) && (
        <div className={styles.approvalActions}>
          <ReviewDetailsButton
            approval={approval}
            locked={locked}
            onReview={onReview}
          />
          {showDecision && (
            <DecisionButtons
              approval={approval}
              locked={locked}
              onApprove={onApprove}
              onReject={onReject}
            />
          )}
        </div>
      )}
      {deciding && (
        <span className="visually-hidden" role="status">
          {approval.status === 'approving' ? 'Approving…' : 'Denying…'}
        </span>
      )}
    </div>
  );
}

/**
 * A change that the agent wants to make. A pending change asks for an
 * explicit Approve or Deny; a decided one shrinks to one line; a failed one
 * explains its outcome. Automatic approvals show only when they fail.
 */
export function ApprovalEntry({
  approval,
  autoApproveEnabled,
  locked,
  onReview,
  onApprove,
  onReject,
  onRepair,
}: ApprovalEntryProps) {
  if (approval.automatic && !approval.error && !approval.outcome) {
    return null;
  }

  const isResolved =
    approval.status === 'approved' || approval.status === 'rejected';

  if (isResolved && approval.outcome) {
    return (
      <ApprovalOutcomeEntry
        approval={approval}
        autoApproveEnabled={autoApproveEnabled}
        locked={locked}
        onRepair={onRepair}
        onReview={onReview}
      />
    );
  }

  if (isResolved) {
    return (
      <ResolvedApprovalEntry
        approval={approval}
        locked={locked}
        onReview={onReview}
      />
    );
  }

  return (
    <PendingApprovalEntry
      approval={approval}
      locked={locked}
      onApprove={onApprove}
      onReject={onReject}
      onReview={onReview}
    />
  );
}
