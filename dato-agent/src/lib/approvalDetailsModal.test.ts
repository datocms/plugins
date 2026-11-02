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
    script: {
      language: 'typescript',
      source: 'await client.items.update("homepage", { title: "Hello" });',
    },
    outcome: {
      kind: 'failed_before_execution',
      diagnostic: 'TypeScript compilation failed.',
    },
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
          script: {
            language: 'typescript',
            source:
              'await client.items.update("homepage", { title: "Hello" });',
          },
          outcome: {
            kind: 'failed_before_execution',
            diagnostic: 'TypeScript compilation failed.',
          },
        },
      }),
    );
  });

  it('ignores decisions returned for a resolved approval', async () => {
    const openModal = vi.fn().mockResolvedValue('approve');

    await expect(
      openApprovalDetailsModal({ openModal }, approval('approved')),
    ).resolves.toBeNull();
    // The modal tells the decision already taken
    expect(openModal).toHaveBeenCalledWith(
      expect.objectContaining({
        parameters: expect.objectContaining({
          canDecide: false,
          decision: 'approved',
        }),
      }),
    );
  });

  it('tells no decision for a change that ended with an error', async () => {
    const openModal = vi.fn().mockResolvedValue(null);
    const { outcome: _outcome, ...withoutOutcome } = approval('rejected');

    await openApprovalDetailsModal(
      { openModal },
      {
        ...withoutOutcome,
        error:
          'Your DatoCMS access changed, so nothing was changed: ask the agent again.',
      },
    );
    // The editor didn't deny it: "Denied" would be wrong
    expect(openModal.mock.calls[0]?.[0].parameters).not.toHaveProperty(
      'decision',
    );
  });

  it('passes the plain error of a failed change with its outcome', async () => {
    const openModal = vi.fn().mockResolvedValue(null);

    await openApprovalDetailsModal(
      { openModal },
      { ...approval('approved'), error: 'The Italian title is required.' },
    );
    expect(openModal).toHaveBeenCalledWith(
      expect.objectContaining({
        parameters: expect.objectContaining({
          error: 'The Italian title is required.',
          outcome: expect.objectContaining({ kind: 'failed_before_execution' }),
        }),
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
