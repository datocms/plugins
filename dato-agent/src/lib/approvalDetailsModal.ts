import type { Modal } from 'datocms-plugin-sdk';
import type { UnsafeApprovalViewModel } from '../components/AgentSurface';

export const APPROVAL_DETAILS_MODAL_ID = 'dato-agent-approval-details';

export type ApprovalDetailsDecision = 'approve' | 'deny';

type ModalOpener = {
  openModal: (modal: Modal) => Promise<unknown>;
};

export async function openApprovalDetailsModal(
  ctx: ModalOpener,
  approval: UnsafeApprovalViewModel,
): Promise<ApprovalDetailsDecision | null> {
  const canDecide = approval.status === 'pending';
  const result = await ctx.openModal({
    id: APPROVAL_DETAILS_MODAL_ID,
    title: 'Change details',
    width: 'l',
    initialHeight: 560,
    parameters: {
      details: approval.details ?? [],
      ...(approval.script ? { script: approval.script } : {}),
      ...(approval.outcome ? { outcome: approval.outcome } : {}),
      canDecide,
    },
  });

  return canDecide && (result === 'approve' || result === 'deny')
    ? result
    : null;
}
