import type { Modal } from 'datocms-plugin-sdk';
import type { UnsafeApprovalViewModel } from '../components/AgentSurface';

export const APPROVAL_DETAILS_MODAL_ID = 'dato-agent-approval-details';

type ModalOpener = {
  openModal: (modal: Modal) => Promise<unknown>;
};

export function openApprovalDetailsModal(
  ctx: ModalOpener,
  approval: UnsafeApprovalViewModel,
): Promise<unknown> {
  return ctx.openModal({
    id: APPROVAL_DETAILS_MODAL_ID,
    title: 'Change details',
    width: 'l',
    initialHeight: 560,
    parameters: {
      details: approval.details ?? [],
    },
  });
}
