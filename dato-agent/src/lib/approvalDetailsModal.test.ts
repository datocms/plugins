import { describe, expect, it, vi } from 'vitest';
import type { UnsafeApprovalViewModel } from '../components/AgentSurface';
import { openApprovalDetailsModal } from './approvalDetailsModal';

function approval(
  status: UnsafeApprovalViewModel['status'],
): UnsafeApprovalViewModel {
  return {
    id: 'approval-1',
    title: 'Review this change',
    description: 'Update the Homepage title.',
    actionLabel: 'Approve',
    details: [{ label: 'Target', value: 'Homepage' }],
    status,
  };
}

describe('openApprovalDetailsModal', () => {
  it('returns a validated decision for a pending approval', async () => {
    const openModal = vi.fn().mockResolvedValue('approve');

    await expect(
      openApprovalDetailsModal({ openModal }, approval('pending')),
    ).resolves.toBe('approve');
    expect(openModal).toHaveBeenCalledWith(
      expect.objectContaining({
        parameters: {
          canDecide: true,
          details: [{ label: 'Target', value: 'Homepage' }],
        },
      }),
    );
  });

  it('ignores decisions returned for a resolved approval', async () => {
    const openModal = vi.fn().mockResolvedValue('approve');

    await expect(
      openApprovalDetailsModal({ openModal }, approval('approved')),
    ).resolves.toBeNull();
    expect(openModal).toHaveBeenCalledWith(
      expect.objectContaining({
        parameters: expect.objectContaining({ canDecide: false }),
      }),
    );
  });

  it('ignores malformed modal results', async () => {
    const openModal = vi.fn().mockResolvedValue('approve-everything');

    await expect(
      openApprovalDetailsModal({ openModal }, approval('pending')),
    ).resolves.toBeNull();
  });
});
