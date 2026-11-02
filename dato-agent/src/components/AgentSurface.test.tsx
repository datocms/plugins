import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_CONVERSATION_MESSAGE_CHARACTERS } from '../lib/conversations';
import type { AgentMentionHost } from '../lib/mentionHost';
import { fallbackAssetMention, fallbackRecordMention } from '../lib/mentions';
import { renderInCanvas } from '../test/canvas';
import {
  type AgentConnectionViewModel,
  type AgentConversationSummaryViewModel,
  AgentSurface,
  type UnsafeApprovalViewModel,
} from './AgentSurface';

let scrollIntoView: ReturnType<typeof vi.fn>;

beforeEach(() => {
  scrollIntoView = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoView,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** The auto-approve toggle of the chat bar: "Auto", and "On" while it is on */
function autoApproveToggle() {
  return screen.getByRole('button', { name: /^Auto/ });
}

/**
 * The tooltip that a control opens on keyboard focus. A tooltip that closes
 * stays in the page during its animation, so this takes the one that
 * describes the control.
 */
function tooltipOf(trigger: HTMLElement) {
  fireEvent.focus(trigger);
  return screen
    .getAllByRole('tooltip')
    .find((tooltip) => tooltip.id === trigger.getAttribute('aria-describedby'));
}

/** The row of a chat in the chats panel, or null when it is a static row */
function chatRow(title: string) {
  return screen.getByText(title).closest<HTMLElement>('[role="button"]');
}

const connected: AgentConnectionViewModel = {
  status: 'connected',
  statusLabel: 'Ready',
  contextLabel: 'Editorial sandbox',
  openAiConfigStatus: 'configured',
  datoCmsStatus: 'connected',
  datoCmsAccountLabel: 'Marketing website',
};

const recentConversations: readonly AgentConversationSummaryViewModel[] = [
  {
    id: 'current-chat',
    title: 'Describe this project',
    preview: 'This project contains landing pages and articles.',
    updatedAtLabel: 'Just now',
    isCurrent: true,
  },
  {
    id: 'second-chat',
    title: 'Update the homepage',
    preview: 'The homepage title was updated.',
    updatedAtLabel: '12 min',
  },
  {
    id: 'third-chat',
    title: 'Find draft articles',
    updatedAtLabel: 'Yesterday',
  },
  {
    id: 'older-chat',
    title: 'Review campaign assets',
    updatedAtLabel: 'Monday',
  },
  {
    id: 'fifth-chat',
    title: 'Summarize recent changes',
    updatedAtLabel: 'Last week',
  },
  {
    id: 'sixth-chat',
    title: 'Check product descriptions',
    updatedAtLabel: 'Last week',
  },
  {
    id: 'seventh-chat',
    title: 'This chat is outside the six-item limit',
    updatedAtLabel: 'Last month',
  },
];

describe('AgentSurface', () => {
  it('starts minimal and sends on Enter without visible keyboard instructions', () => {
    const onSubmit = vi.fn();

    renderInCanvas(
      <AgentSurface connection={connected} entries={[]} onSubmit={onSubmit} />,
    );

    expect(screen.getByText('No messages yet')).toBeVisible();
    // The bar names the chat: a chat with no messages yet is a new chat
    expect(screen.getByText('New chat')).toBeVisible();
    expect(screen.queryByText('Dato Agent')).not.toBeInTheDocument();
    expect(screen.queryByText('Editorial sandbox')).not.toBeInTheDocument();
    expect(screen.queryByText('Ready')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Enter to send|Shift\+Enter/i),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open chats' })).toBeVisible();

    const composer = screen.getByRole('textbox', {
      name: 'Message the DatoCMS agent',
    });
    expect(composer).toHaveAttribute(
      'maxlength',
      String(MAX_CONVERSATION_MESSAGE_CHARACTERS),
    );
    // Send is the main action of the composer: an icon button (soft, the
    // visible tone of an icon button), whose label is its name and its
    // tooltip
    const sendButton = screen.getByRole('button', { name: 'Send' });
    expect(sendButton).not.toHaveTextContent('Send');
    expect(sendButton.querySelector('svg')).not.toBeNull();
    // The kit draws a soft button with its base class alone
    expect(sendButton).toHaveClass('button');
    expect(sendButton).not.toHaveClass('button--primary');
    expect(sendButton).not.toHaveClass('button--ghost');
    fireEvent.paste(composer, {
      clipboardData: {
        getData: () => 'Describe this project',
        types: ['text/plain'],
      },
    });
    fireEvent.keyDown(composer, { key: 'Enter', shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith({
      displayText: 'Describe this project',
      providerText: 'Describe this project',
      segments: [{ type: 'text', content: 'Describe this project' }],
    });
    expect(composer).toHaveTextContent('');
  });

  it('shows browser persistence failures next to the composer', () => {
    renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[]}
        onSubmit={vi.fn()}
        persistenceWarning="This chat could not be saved in this browser."
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'This chat could not be saved in this browser.',
    );
    expect(
      screen.getByRole('textbox', { name: 'Message the DatoCMS agent' }),
    ).toBeVisible();
  });

  it('puts stop in the composer while a turn is running', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();

    renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[
          {
            id: 'activity',
            kind: 'activity',
            phase: 'running',
            activities: [],
          },
        ]}
        isRunning
        onStop={onStop}
        onSubmit={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('textbox', { name: 'Message the DatoCMS agent' }),
    ).toHaveAttribute('aria-disabled', 'true');
    const working = screen.getByText('Working…');
    expect(working).toBeVisible();
    expect(working.closest('details')).toBeNull();
    const stopButton = screen.getByRole('button', { name: 'Stop' });
    expect(stopButton).not.toHaveTextContent('Stop');
    expect(stopButton.querySelector('svg')).not.toBeNull();
    await user.click(stopButton);
    expect(onStop).toHaveBeenCalledOnce();
  });

  it('shows one quiet stopped marker for an interrupted turn with activity', () => {
    renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[
          {
            id: 'user',
            kind: 'message',
            role: 'user',
            content: 'Find the best pages for me.',
          },
          {
            id: 'activity',
            kind: 'activity',
            phase: 'cancelled',
            activities: [
              {
                id: 'thinking',
                label: 'Thinking',
                status: 'cancelled',
              },
            ],
          },
          {
            id: 'assistant',
            kind: 'message',
            role: 'assistant',
            content: 'Stopped.',
            interrupted: true,
          },
        ]}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getAllByText('Stopped')).toHaveLength(1);
  });

  it('keeps recovered tool activity behind one quiet disclosure', async () => {
    const user = userEvent.setup();

    renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[
          {
            id: 'activity',
            kind: 'activity',
            phase: 'completed',
            activities: [
              {
                id: 'schema',
                label: 'Reading the content model',
                status: 'success',
              },
              {
                id: 'script',
                label: 'Reading CMS content',
                detail: 'Replacement 1: String not found',
                status: 'error',
              },
            ],
          },
        ]}
        onSubmit={vi.fn()}
      />,
    );

    const summary = screen.getByRole('button', { name: '2 steps' });
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Reading the content model')).not.toBeVisible();
    expect(screen.queryByText('1 DatoCMS step failed')).not.toBeInTheDocument();

    await user.click(summary);
    expect(summary).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Reading the content model')).toBeVisible();
    expect(screen.getByText('Not completed')).toBeVisible();
    // The detail of a step is technical: it waits behind its own disclosure
    expect(
      screen.getByText('Replacement 1: String not found'),
    ).not.toBeVisible();
    await user.click(
      screen.getByRole('button', {
        name: 'Show the details of Reading CMS content',
      }),
    );
    expect(screen.getByText('Replacement 1: String not found')).toBeVisible();
  });

  it('shows recoverable failures as ongoing work until the next step starts', () => {
    const { rerender } = renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[
          {
            id: 'activity',
            kind: 'activity',
            phase: 'running',
            activities: [
              {
                id: 'script',
                label: 'Reading CMS content',
                status: 'error',
              },
            ],
          },
        ]}
        isRunning
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText('Trying another approach…')).toBeVisible();
    expect(screen.queryByText(/step failed/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Try again' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Copy error details' }),
    ).not.toBeInTheDocument();

    rerender(
      <AgentSurface
        connection={connected}
        entries={[
          {
            id: 'activity',
            kind: 'activity',
            phase: 'running',
            activities: [
              {
                id: 'script',
                label: 'Reading CMS content',
                status: 'error',
              },
              {
                id: 'retry',
                label: 'Checking another approach',
                status: 'running',
              },
            ],
          },
        ]}
        isRunning
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getAllByText('Checking another approach')).toHaveLength(2);
    expect(
      screen.queryByText('Trying another approach…'),
    ).not.toBeInTheDocument();
  });

  it('does not make completed activity look active during a later turn', () => {
    renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[
          {
            id: 'completed-activity',
            kind: 'activity',
            phase: 'completed',
            activities: [
              {
                id: 'old-script',
                label: 'Reading CMS content',
                status: 'error',
              },
            ],
          },
          {
            id: 'current-activity',
            kind: 'activity',
            phase: 'running',
            activities: [],
          },
        ]}
        isRunning
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText('1 step')).toBeVisible();
    expect(screen.getByText('Working…')).toBeVisible();
    expect(
      screen.queryByText('Trying another approach…'),
    ).not.toBeInTheDocument();
  });

  it('keeps the summary of a failed turn neutral: its error says it once', () => {
    renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[
          {
            id: 'activity',
            kind: 'activity',
            phase: 'failed',
            activities: [
              {
                id: 'script',
                label: 'Reading CMS content',
                status: 'error',
              },
            ],
          },
        ]}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '1 step' })).toBeVisible();
    expect(
      screen.queryByText('Couldn’t complete this request'),
    ).not.toBeInTheDocument();
  });

  it('requires explicit approval and keeps TypeScript in the details modal', async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const onReview = vi.fn();
    const approval: UnsafeApprovalViewModel = {
      id: 'approval-1',
      title: 'Update three article titles',
      description: 'This will change the title field on three records.',
      actionLabel: 'Run title normalization',
      script: {
        language: 'typescript',
        source: 'await client.items.update("123", { title: "Hello" });',
      },
      status: 'pending',
    };

    renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[{ id: 'entry-1', kind: 'approval', approval }]}
        onApproveUnsafeAction={onApprove}
        onRejectUnsafeAction={onReject}
        onReviewUnsafeAction={onReview}
        onSubmit={vi.fn()}
      />,
    );

    const approvalGroup = screen.getByRole('group', {
      name: 'Update three article titles',
    });
    expect(approvalGroup).toBeVisible();
    expect(approvalGroup).not.toHaveAttribute('role', 'alert');
    expect(screen.queryByText('CONTENT CHANGE')).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        'await client.items.update("123", { title: "Hello" });',
      ),
    ).not.toBeInTheDocument();
    const detailsButton = screen.getByRole('button', {
      name: 'Review details',
    });
    expect(detailsButton).toHaveAttribute('aria-haspopup', 'dialog');
    await user.click(detailsButton);
    expect(onReview).toHaveBeenCalledWith(approval);
    expect(detailsButton).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onApprove).toHaveBeenCalledWith(approval);

    await user.click(screen.getByRole('button', { name: 'Deny' }));
    expect(onReject).toHaveBeenCalledWith(approval);
  });

  it('does not present an in-progress approval as rejected', () => {
    const approval: UnsafeApprovalViewModel = {
      id: 'approval-progress',
      title: 'Update an article title',
      description: 'This will change one record.',
      actionLabel: 'Update title',
      status: 'approving',
    };

    renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[{ id: 'entry-progress', kind: 'approval', approval }]}
        onApproveUnsafeAction={vi.fn()}
        onRejectUnsafeAction={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    // The decision that saves is busy, and the other one waits for it
    expect(screen.getByText('Approving…')).toHaveRole('status');
    const approve = screen.getByRole('button', { name: 'Approve' });
    expect(approve).toHaveAttribute('aria-busy', 'true');
    expect(approve).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(
      screen.queryByText('Denied. No action was taken.'),
    ).not.toBeInTheDocument();
  });

  it('presents approval errors as terminal instead of offering stale actions', () => {
    const approval: UnsafeApprovalViewModel = {
      id: 'approval-error',
      title: 'Delete old drafts',
      description: 'This will delete old draft records.',
      actionLabel: 'Delete 12 drafts',
      status: 'error',
      error: 'Approval could not be recorded.',
    };

    renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[{ id: 'entry-error', kind: 'approval', approval }]}
        onApproveUnsafeAction={vi.fn()}
        onRejectUnsafeAction={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Approval could not be recorded.',
    );
    // The card still says which change it was
    expect(
      screen.getByRole('group', { name: 'Delete old drafts' }),
    ).toHaveAccessibleDescription(
      'This will delete old draft records. Approval could not be recorded.',
    );
    expect(
      screen.queryByRole('button', { name: 'Approve' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Deny' }),
    ).not.toBeInTheDocument();
  });

  it('uses deny language after a rejected approval', () => {
    const approval: UnsafeApprovalViewModel = {
      id: 'approval-rejected',
      title: 'Delete old drafts',
      description: 'This will delete old draft records.',
      actionLabel: 'Delete 12 drafts',
      status: 'rejected',
    };

    renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[{ id: 'entry-rejected', kind: 'approval', approval }]}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText('Denied. No action was taken.')).toHaveRole(
      'status',
    );
  });

  it('offers a fresh repair turn only for a definitely unexecuted change', async () => {
    const user = userEvent.setup();
    const onRepair = vi.fn();
    const approval: UnsafeApprovalViewModel = {
      id: 'repairable-approval',
      title: 'Update the Homepage',
      description: 'This will update one record.',
      actionLabel: 'Update Homepage',
      status: 'approved',
      outcome: {
        kind: 'failed_before_execution',
        diagnostic: 'TypeScript compilation failed.',
      },
      recovery: { status: 'available' },
      script: {
        language: 'typescript',
        source: 'await client.items.update("homepage", {});',
      },
    };

    renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[{ id: 'repairable-entry', kind: 'approval', approval }]}
        onRepairUnsafeAction={onRepair}
        onReviewUnsafeAction={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText('Change didn’t run')).toBeVisible();
    expect(screen.getByText('Nothing was changed.')).toBeVisible();
    expect(screen.queryByText('Approved.')).not.toBeInTheDocument();
    const repair = screen.getByRole('button', {
      name: 'Ask the agent to fix it',
    });
    await user.click(repair);
    expect(onRepair).toHaveBeenCalledWith(approval);
    expect(
      screen.getByRole('button', { name: 'Review details' }),
    ).toBeVisible();
  });

  it('says in view that auto-approve can run the fix of an automatic failure', () => {
    renderInCanvas(
      <AgentSurface
        autoApproveEnabled
        connection={connected}
        entries={[
          {
            id: 'automatic-repairable-entry',
            kind: 'approval',
            approval: {
              id: 'automatic-repairable',
              title: 'Update records',
              description: 'Update records.',
              actionLabel: 'Update',
              automatic: true,
              status: 'approved',
              outcome: { kind: 'failed_before_execution' },
              recovery: { status: 'available' },
            },
          },
        ]}
        onRepairUnsafeAction={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Ask the agent to fix it' }),
    ).toBeVisible();
    expect(
      screen.getByText(
        'Auto-approve is on, so the fix can run without asking you.',
      ),
    ).toBeVisible();
  });

  it.each([
    [
      'failed_after_execution' as const,
      'Change may be incomplete',
      'Some content may have changed. Ask the agent to check, or look at the content yourself.',
    ],
    [
      'unknown' as const,
      'Not sure the change ran',
      'Ask the agent to check, or look at the content yourself.',
    ],
  ])('does not offer repair for %s outcomes', (kind, title, description) => {
    renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[
          {
            id: `outcome-${kind}`,
            kind: 'approval',
            approval: {
              id: `approval-${kind}`,
              title: 'Update records',
              description: 'Update records.',
              actionLabel: 'Update',
              status: 'approved',
              outcome: { kind },
            },
          },
        ]}
        onRepairUnsafeAction={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText(title)).toBeVisible();
    expect(screen.getByText(description)).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /fix/i }),
    ).not.toBeInTheDocument();
  });

  it('locks a claimed repair action while the correction turn starts', () => {
    renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[
          {
            id: 'starting-repair',
            kind: 'approval',
            approval: {
              id: 'starting-repair-approval',
              title: 'Update records',
              description: 'Update records.',
              actionLabel: 'Update',
              status: 'approved',
              outcome: { kind: 'failed_before_execution' },
              recovery: { status: 'starting' },
            },
          },
        ]}
        onRepairUnsafeAction={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Preparing fix…' }),
    ).toBeDisabled();
  });

  it('keeps every record in a multi-record result individually accessible', async () => {
    const user = userEvent.setup();
    const onOpenRecord = vi.fn();

    renderInCanvas(
      <AgentSurface
        connection={connected}
        currentRecordId="one"
        entries={[
          {
            id: 'records',
            kind: 'records',
            title: 'Matching articles',
            records: [
              { itemId: 'one', title: 'One' },
              { itemId: 'two', title: 'Two' },
            ],
          },
        ]}
        onOpenRecord={onOpenRecord}
        onSubmit={vi.fn()}
      />,
    );

    const receipt = screen.getByRole('group', { name: 'Matching articles' });
    // The record already open is a static row that says so
    const current = within(receipt).getByText('Current record');
    expect(current.closest('[aria-current="true"]')).toHaveTextContent('One');
    expect(current.closest('[role="button"]')).toBeNull();
    expect(within(receipt).getAllByRole('button')).toHaveLength(1);
    await user.click(within(receipt).getByRole('button', { name: /Two/ }));
    expect(onOpenRecord).toHaveBeenCalledOnce();
    expect(onOpenRecord).toHaveBeenCalledWith(
      {
        itemId: 'two',
        title: 'Two',
      },
      'records',
    );
  });

  it('opens record, field, asset, model, and user mentions directly from user messages', async () => {
    const user = userEvent.setup();
    const onOpenRecord = vi.fn();
    const onOpenField = vi.fn();
    const onOpenAsset = vi.fn();
    const openModel = vi.fn();
    const openUser = vi.fn();
    const openLocalFile = vi.fn(async () => undefined);
    const mentionHost = {
      currentUser: {
        id: 'current-user',
        name: 'Editor',
        email: 'editor@example.com',
        avatarUrl: 'https://example.com/editor.png',
        userType: 'user',
      },
      projectOwnerId: 'project-owner',
      projectModels: [],
      recordModels: [],
      canMentionFields: true,
      canMentionAssets: true,
      canMentionModels: true,
      loadProjectUsers: async () => [],
      loadModelFields: async () => [],
      selectAsset: async () => undefined,
      selectRecord: async () => undefined,
      resolveAsset: async ({ uploadId, label }) =>
        fallbackAssetMention(uploadId, label || `Asset #${uploadId}`),
      resolveRecord: async ({ itemId, label }) =>
        fallbackRecordMention({
          id: itemId,
          title: label || `Record #${itemId}`,
        }),
      openModel,
      openUser,
      openLocalFile,
    } satisfies AgentMentionHost;

    renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[
          {
            id: 'user-with-mentions',
            kind: 'message',
            role: 'user',
            content: 'Open Homepage #title Hero.jpg brief.pdf Page @Ada',
            segments: [
              { type: 'text', content: 'Open ' },
              {
                type: 'mention',
                mention: {
                  type: 'record',
                  id: 'record-1',
                  title: 'Homepage',
                  modelId: 'model-1',
                  modelApiKey: 'page',
                  modelName: 'Page',
                  modelEmoji: null,
                  thumbnailUrl: null,
                },
              },
              { type: 'text', content: ' ' },
              {
                type: 'mention',
                mention: {
                  type: 'field',
                  apiKey: 'title',
                  label: 'Title',
                  localized: false,
                  fieldPath: 'title',
                },
              },
              { type: 'text', content: ' ' },
              {
                type: 'mention',
                mention: {
                  type: 'asset',
                  id: 'upload-1',
                  filename: 'Hero.jpg',
                  url: '',
                  thumbnailUrl: null,
                  mimeType: 'image/jpeg',
                },
              },
              { type: 'text', content: ' ' },
              {
                type: 'mention',
                mention: {
                  type: 'file',
                  id: 'local-file-1',
                  filename: 'brief.pdf',
                  mimeType: 'application/pdf',
                  size: 2048,
                  lastModified: 1_786_000_000_000,
                },
              },
              { type: 'text', content: ' ' },
              {
                type: 'mention',
                mention: {
                  type: 'model',
                  id: 'model-1',
                  apiKey: 'page',
                  name: 'Page',
                  isBlockModel: false,
                },
              },
              { type: 'text', content: ' ' },
              {
                type: 'mention',
                mention: {
                  type: 'user',
                  id: 'user-1',
                  name: 'Ada',
                  email: 'ada@example.com',
                  avatarUrl: null,
                },
              },
            ],
          },
        ]}
        mentionHost={mentionHost}
        onOpenAsset={onOpenAsset}
        onOpenField={onOpenField}
        onOpenRecord={onOpenRecord}
        onSubmit={vi.fn()}
      />,
    );

    const userMessage = screen.getByRole('article', { name: 'You' });
    expect(within(userMessage).queryByText('Editor')).not.toBeInTheDocument();
    expect(
      userMessage.querySelector('img[src="https://example.com/editor.png"]'),
    ).toBeNull();
    expect(userMessage.querySelector('time')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Homepage' }));
    expect(onOpenRecord).toHaveBeenCalledWith({
      itemId: 'record-1',
      itemTypeId: 'model-1',
      title: 'Homepage',
    });

    await user.click(screen.getByRole('button', { name: /#title/i }));
    expect(onOpenField).toHaveBeenCalledWith({
      fieldPath: 'title',
      title: 'Title',
    });

    await user.click(screen.getByRole('button', { name: 'Hero.jpg' }));
    expect(onOpenAsset).toHaveBeenCalledWith({
      uploadId: 'upload-1',
      title: 'Hero.jpg',
    });

    await user.click(screen.getByRole('button', { name: 'brief.pdf' }));
    expect(openLocalFile).toHaveBeenCalledWith({
      type: 'file',
      id: 'local-file-1',
      filename: 'brief.pdf',
      mimeType: 'application/pdf',
      size: 2048,
      lastModified: 1_786_000_000_000,
    });

    await user.click(screen.getByRole('button', { name: 'Page' }));
    expect(openModel).toHaveBeenCalledWith('model-1', false);

    await user.click(screen.getByRole('button', { name: '@Ada' }));
    expect(openUser).toHaveBeenCalledWith('user-1');
  });

  it('keeps inline mentions clickable while the agent is working', async () => {
    const user = userEvent.setup();
    const onOpenRecord = vi.fn();

    renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[
          {
            id: 'user-mention-running',
            kind: 'message',
            role: 'user',
            content: 'Open Homepage',
            segments: [
              { type: 'text', content: 'Open ' },
              {
                type: 'mention',
                mention: {
                  type: 'record',
                  id: 'homepage',
                  title: 'Homepage',
                  modelId: 'page',
                  modelApiKey: 'page',
                  modelName: 'Page',
                  modelEmoji: null,
                  thumbnailUrl: null,
                },
              },
            ],
          },
          {
            id: 'working',
            kind: 'activity',
            phase: 'running',
            activities: [],
          },
        ]}
        isRunning
        onOpenRecord={onOpenRecord}
        onSubmit={vi.fn()}
      />,
    );

    const mention = screen.getByRole('button', { name: 'Homepage' });
    expect(mention).toBeEnabled();
    await user.click(mention);
    expect(onOpenRecord).toHaveBeenCalledWith({
      itemId: 'homepage',
      itemTypeId: 'page',
      title: 'Homepage',
    });
  });

  it('keeps record results clickable while the agent is still running', async () => {
    const user = userEvent.setup();
    const onOpenRecord = vi.fn();

    renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[
          {
            id: 'running-records',
            kind: 'records',
            records: [{ itemId: 'one', title: 'One' }],
          },
        ]}
        isRunning
        onOpenRecord={onOpenRecord}
        onSubmit={vi.fn()}
      />,
    );

    const openButton = screen.getByRole('button', { name: /One/ });
    expect(openButton).not.toHaveAttribute('aria-disabled');
    await user.click(openButton);
    expect(onOpenRecord).toHaveBeenCalledWith(
      { itemId: 'one', title: 'One' },
      'running-records',
    );
  });

  it('locks a record receipt while its modal is opening', async () => {
    const user = userEvent.setup();
    const onOpenRecord = vi.fn();

    renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[
          {
            id: 'opening-record',
            kind: 'records',
            records: [{ itemId: 'one', title: 'One' }],
            opening: true,
          },
        ]}
        onOpenRecord={onOpenRecord}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole('group', { name: 'Records' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    await user.click(screen.getByRole('button', { name: /One/ }));
    expect(onOpenRecord).not.toHaveBeenCalled();
  });

  it('keeps tool-only records in an accessible agent turn', () => {
    renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[
          {
            id: 'tool-only-assistant',
            kind: 'message',
            role: 'assistant',
            content: '',
          },
          {
            id: 'tool-only-records',
            kind: 'records',
            title: 'Useful record',
            records: [{ itemId: 'one', title: 'One' }],
          },
        ]}
        onOpenRecord={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    const agentTurn = screen.getByRole('article', { name: 'Dato Agent' });
    expect(within(agentTurn).queryByText('Dato Agent')).not.toBeInTheDocument();
    expect(agentTurn.querySelector('img[aria-hidden="true"]')).toBeNull();
    expect(agentTurn.querySelector('time')).toBeNull();
    expect(within(agentTurn).getByLabelText('Useful record')).toBeVisible();
  });

  it('keeps activity, references, approval, and response in one agent turn', () => {
    const approval: UnsafeApprovalViewModel = {
      id: 'approval-in-turn',
      title: 'Publish Homepage',
      description: 'This will publish the Homepage record.',
      actionLabel: 'Publish',
      status: 'pending',
    };

    renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[
          {
            id: 'question',
            kind: 'message',
            role: 'user',
            content: 'Publish the homepage',
          },
          {
            id: 'activity-in-turn',
            kind: 'activity',
            phase: 'waiting',
            activities: [
              {
                id: 'lookup',
                label: 'Finding the Homepage',
                status: 'success',
              },
            ],
          },
          {
            id: 'record-in-turn',
            kind: 'records',
            title: 'Homepage',
            records: [{ itemId: 'home', title: 'Homepage' }],
          },
          { id: 'approval-in-turn', kind: 'approval', approval },
          {
            id: 'response-in-turn',
            kind: 'message',
            role: 'assistant',
            content: 'The Homepage is ready for approval.',
          },
        ]}
        onApproveUnsafeAction={vi.fn()}
        onOpenRecord={vi.fn()}
        onRejectUnsafeAction={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    const agentTurns = screen.getAllByRole('article', { name: 'Dato Agent' });
    expect(agentTurns).toHaveLength(1);
    const agentTurn = agentTurns[0];
    // The card asks for the decision: the summary only counts the steps
    expect(within(agentTurn).getByText('1 step')).toBeVisible();
    expect(
      within(agentTurn).queryByText('Waiting for approval'),
    ).not.toBeInTheDocument();
    expect(within(agentTurn).getByLabelText('Homepage')).toBeVisible();
    expect(
      within(agentTurn).getByRole('group', { name: 'Publish Homepage' }),
    ).toBeVisible();
    expect(
      within(agentTurn).getByText('The Homepage is ready for approval.'),
    ).toBeVisible();
  });

  it('starts a fresh agent turn after each user message', () => {
    renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[
          { id: 'user-1', kind: 'message', role: 'user', content: 'First' },
          {
            id: 'agent-1',
            kind: 'message',
            role: 'assistant',
            content: 'First response',
          },
          { id: 'user-2', kind: 'message', role: 'user', content: 'Second' },
          {
            id: 'agent-2',
            kind: 'message',
            role: 'assistant',
            content: 'Second response',
          },
        ]}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getAllByRole('article', { name: 'Dato Agent' })).toHaveLength(
      2,
    );
  });

  it('separates user and agent turns without visible identity headers', () => {
    renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[
          {
            id: 'user',
            kind: 'message',
            role: 'user',
            content: 'Show the homepage',
            createdAt: '2026-08-04T14:00:00.000Z',
          },
          {
            id: 'agent',
            kind: 'message',
            role: 'assistant',
            content: 'Here is the homepage.',
            createdAt: '2026-08-04T14:01:00.000Z',
          },
        ]}
        onSubmit={vi.fn()}
      />,
    );

    const userTurn = screen.getByRole('article', { name: 'You' });
    const agentTurn = screen.getByRole('article', { name: 'Dato Agent' });
    expect(userTurn.className).not.toBe(agentTurn.className);
    expect(within(userTurn).queryByText('Dato Agent')).not.toBeInTheDocument();
    expect(within(agentTurn).queryByText('Dato Agent')).not.toBeInTheDocument();
    expect(userTurn.querySelector('img, time')).toBeNull();
    expect(agentTurn.querySelector('img, time')).toBeNull();
  });

  it('shows a compact navigation error with its record results', () => {
    renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[
          {
            id: 'records-error',
            kind: 'records',
            records: [{ itemId: 'one', title: 'One' }],
            error: 'Could not open this record. Access denied.',
          },
        ]}
        onOpenRecord={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not open this record. Access denied.',
    );
  });

  it('renders compact clickable field and asset references', async () => {
    const user = userEvent.setup();
    const onOpenField = vi.fn();
    const onOpenAsset = vi.fn();

    renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[
          {
            id: 'fields',
            kind: 'fields',
            title: 'Relevant fields',
            fields: [
              { fieldPath: 'title', title: 'Title', locale: 'en' },
              { fieldPath: 'seo', title: 'SEO' },
            ],
          },
          {
            id: 'assets',
            kind: 'assets',
            title: 'Referenced assets',
            assets: [
              {
                uploadId: 'upload-1',
                title: 'Hero.jpg',
                mention: {
                  type: 'asset',
                  id: 'upload-1',
                  filename: 'Hero.jpg',
                  url: 'https://www.datocms-assets.com/hero.jpg',
                  thumbnailUrl:
                    'https://www.datocms-assets.com/hero.jpg?w=48&fit=max',
                  mimeType: 'image/jpeg',
                },
              },
              {
                uploadId: 'upload-deleted',
                title: 'Old.jpg',
                deleted: true,
              },
            ],
          },
        ]}
        onOpenAsset={onOpenAsset}
        onOpenField={onOpenField}
        onSubmit={vi.fn()}
      />,
    );

    const fields = screen.getByRole('group', { name: 'Relevant fields' });
    expect(within(fields).getByText('English')).toBeVisible();
    await user.click(within(fields).getByRole('button', { name: /Title/ }));
    expect(onOpenField).toHaveBeenCalledWith(
      { fieldPath: 'title', title: 'Title', locale: 'en' },
      'fields',
    );

    const assets = screen.getByRole('group', { name: 'Referenced assets' });
    const heroAsset = within(assets).getByRole('button', { name: /Hero/ });
    expect(heroAsset.querySelector('img')).toHaveAttribute(
      'src',
      'https://www.datocms-assets.com/hero.jpg?w=48&fit=max',
    );
    await user.click(heroAsset);
    expect(onOpenAsset).toHaveBeenCalledWith(
      expect.objectContaining({ uploadId: 'upload-1', title: 'Hero.jpg' }),
      'assets',
    );
    // A deleted asset can't open: a static row that says why
    expect(
      within(assets).queryByRole('button', { name: /Old/ }),
    ).not.toBeInTheDocument();
    expect(within(assets).getByText('Old.jpg')).toBeVisible();
    expect(within(assets).getByText('Deleted')).toBeVisible();
  });

  it('locks every clickable receipt while a host UI action is pending', async () => {
    const user = userEvent.setup();
    const onOpenRecord = vi.fn();
    const onOpenField = vi.fn();
    const onOpenAsset = vi.fn();
    const onAutoApproveChange = vi.fn();
    const approval: UnsafeApprovalViewModel = {
      id: 'approval',
      title: 'Review this change',
      description: 'Review generated details.',
      actionLabel: 'Approve',
      details: [{ label: 'Target', value: 'Homepage' }],
      status: 'pending',
    };

    renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[
          {
            id: 'record',
            kind: 'records',
            records: [{ itemId: 'one', title: 'Record' }],
          },
          {
            id: 'field',
            kind: 'fields',
            fields: [{ fieldPath: 'title', title: 'Title' }],
          },
          {
            id: 'asset',
            kind: 'assets',
            assets: [{ uploadId: 'upload-1', title: 'Hero.jpg' }],
          },
          {
            id: 'approval',
            kind: 'approval',
            approval,
          },
        ]}
        onApproveUnsafeAction={vi.fn()}
        onAutoApproveChange={onAutoApproveChange}
        onOpenAsset={onOpenAsset}
        onOpenField={onOpenField}
        onOpenRecord={onOpenRecord}
        onRejectUnsafeAction={vi.fn()}
        onReviewUnsafeAction={vi.fn()}
        onSubmit={vi.fn()}
        hostActionPending
      />,
    );

    // The rows keep their focus, but a click does nothing
    const transcript = within(screen.getByRole('log'));
    await user.click(transcript.getByRole('button', { name: /Record/ }));
    await user.click(transcript.getByRole('button', { name: /Title/ }));
    await user.click(transcript.getByRole('button', { name: /Hero/ }));
    expect(onOpenRecord).not.toHaveBeenCalled();
    expect(onOpenField).not.toHaveBeenCalled();
    expect(onOpenAsset).not.toHaveBeenCalled();

    for (const name of ['Review details', 'Approve', 'Deny', 'Open chats']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
    }
    const toggle = autoApproveToggle();
    expect(toggle).toHaveAttribute('aria-disabled', 'true');
    expect(tooltipOf(toggle)).toHaveTextContent(
      'Wait for the current action to finish.',
    );
    await user.click(toggle);
    expect(onAutoApproveChange).not.toHaveBeenCalled();
  });

  it('shows partial responses together with string errors', () => {
    renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[
          {
            id: 'partial',
            kind: 'message',
            role: 'assistant',
            content: 'I found two matching records.',
            streaming: true,
            error: 'The connection closed before the response finished.',
          },
          {
            id: 'error-only',
            kind: 'message',
            role: 'assistant',
            content: '',
            streaming: true,
            error: 'The request could not be completed.',
          },
          {
            id: 'reloaded-partial',
            kind: 'message',
            role: 'assistant',
            content: 'A partial response restored from history.',
            interrupted: true,
          },
        ]}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText('I found two matching records.')).toBeVisible();
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toHaveTextContent(
      'The connection closed before the response finished.',
    );
    expect(alerts[1]).toHaveTextContent('The request could not be completed.');
    expect(
      screen.getByText('A partial response restored from history.'),
    ).toBeVisible();
    expect(screen.getByText('Stopped')).toHaveRole('status');
    expect(
      screen.queryByRole('button', { name: 'Try again' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Copy error details' }),
    ).not.toBeInTheDocument();
  });

  it('offers compact recovery actions only for a terminal assistant failure', async () => {
    const onRetryFailedTurn = vi.fn();
    const onCopyFailureDiagnostics = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[
          {
            id: 'failed-response',
            kind: 'message',
            role: 'assistant',
            content: '',
            error: 'The request could not be completed.',
            failure: { id: 'failure-1', retryable: true },
          },
          {
            id: 'ordinary-error',
            kind: 'message',
            role: 'assistant',
            content: '',
            error: 'An older error without diagnostics.',
          },
          {
            id: 'user-error',
            kind: 'message',
            role: 'user',
            content: 'A user message',
            error: true,
            failure: { id: 'not-terminal', retryable: true },
          },
        ]}
        onCopyFailureDiagnostics={onCopyFailureDiagnostics}
        onRetryFailedTurn={onRetryFailedTurn}
        onSubmit={vi.fn()}
      />,
    );

    const retryButton = screen.getByRole('button', { name: 'Try again' });
    const copyButton = screen.getByRole('button', {
      name: 'Copy error details',
    });
    expect(retryButton.querySelector('svg')).not.toBeNull();
    expect(copyButton.querySelector('svg')).not.toBeNull();
    expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(
      1,
    );
    expect(
      screen.getAllByRole('button', { name: 'Copy error details' }),
    ).toHaveLength(1);

    await user.click(retryButton);
    expect(onRetryFailedTurn).toHaveBeenCalledOnce();
    expect(onRetryFailedTurn).toHaveBeenCalledWith('failure-1');
    // Copying waits for the new attempt to start
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Copy error details' }),
      ).not.toHaveAttribute('aria-disabled'),
    );

    await user.click(
      screen.getByRole('button', { name: 'Copy error details' }),
    );
    expect(onCopyFailureDiagnostics).toHaveBeenCalledOnce();
    expect(onCopyFailureDiagnostics).toHaveBeenCalledWith('failure-1');
  });

  it('shows only diagnostics for a non-retryable terminal failure', () => {
    renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[
          {
            id: 'failed-response',
            kind: 'message',
            role: 'assistant',
            content: 'A partial response.',
            error: 'The request stopped.',
            failure: { id: 'failure-2', retryable: false },
          },
        ]}
        onCopyFailureDiagnostics={vi.fn().mockResolvedValue(undefined)}
        onRetryFailedTurn={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'Try again' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Copy error details' }),
    ).toBeVisible();
  });

  it('disables both failure actions while a retry is in progress', async () => {
    let resolveRetry: (() => void) | undefined;
    const onRetryFailedTurn = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRetry = resolve;
        }),
    );

    renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[
          {
            id: 'failed-response',
            kind: 'message',
            role: 'assistant',
            content: '',
            error: 'The request stopped.',
            failure: { id: 'failure-3', retryable: true },
          },
        ]}
        onCopyFailureDiagnostics={vi.fn().mockResolvedValue(undefined)}
        onRetryFailedTurn={onRetryFailedTurn}
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    const retry = screen.getByRole('button', { name: 'Try again' });
    expect(retry).toBeDisabled();
    expect(retry).toHaveAttribute('aria-busy', 'true');
    expect(
      screen.getByRole('button', { name: 'Copy error details' }),
    ).toHaveAttribute('aria-disabled', 'true');

    await act(async () => {
      resolveRetry?.();
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Copy error details' }),
    ).not.toHaveAttribute('aria-disabled');
  });

  it('announces copied diagnostics for 2 seconds and reports copy failures as an alert', async () => {
    vi.useFakeTimers();
    const onCopyFailureDiagnostics = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Clipboard unavailable'));

    renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[
          {
            id: 'failed-response',
            kind: 'message',
            role: 'assistant',
            content: '',
            error: 'The request stopped.',
            failure: { id: 'failure-4', retryable: false },
          },
        ]}
        onCopyFailureDiagnostics={onCopyFailureDiagnostics}
        onSubmit={vi.fn()}
      />,
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Copy error details' }),
      );
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: 'Copied' })).toBeVisible();
    expect(screen.getByText('Error details copied')).toHaveRole('status');

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(
      screen.getByRole('button', { name: 'Copy error details' }),
    ).toBeVisible();

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Copy error details' }),
      );
      await Promise.resolve();
    });

    const failed = screen.getByRole('button', {
      name: 'Couldn’t copy error details',
    });
    expect(failed).toBeEnabled();
    expect(
      screen.getByText('Couldn’t copy error details', {
        selector: '[role="alert"]',
      }),
    ).toHaveRole('alert');
  });

  it('only follows transcript updates while the reader is near the bottom', () => {
    const { rerender } = renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[
          {
            id: 'message',
            kind: 'message',
            role: 'assistant',
            content: 'First response',
          },
        ]}
        onSubmit={vi.fn()}
      />,
    );

    const transcript = screen.getByRole('log');
    Object.defineProperties(transcript, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, value: 100, writable: true },
    });
    scrollIntoView.mockClear();
    fireEvent.scroll(transcript);

    rerender(
      <AgentSurface
        connection={connected}
        entries={[
          {
            id: 'message',
            kind: 'message',
            role: 'assistant',
            content: 'First response with more text',
          },
        ]}
        onSubmit={vi.fn()}
      />,
    );
    expect(scrollIntoView).not.toHaveBeenCalled();

    transcript.scrollTop = 550;
    fireEvent.scroll(transcript);
    rerender(
      <AgentSurface
        connection={connected}
        entries={[
          {
            id: 'message',
            kind: 'message',
            role: 'assistant',
            content: 'First response with even more text',
          },
        ]}
        onSubmit={vi.fn()}
      />,
    );
    expect(scrollIntoView).toHaveBeenCalledOnce();
  });

  it('reveals a newly submitted turn without following later deltas after the reader scrolls away', () => {
    const { rerender } = renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[
          {
            id: 'first-response',
            kind: 'message',
            role: 'assistant',
            content: 'First response',
          },
        ]}
        onSubmit={vi.fn()}
      />,
    );

    const transcript = screen.getByRole('log');
    Object.defineProperties(transcript, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, value: 100, writable: true },
    });
    scrollIntoView.mockClear();
    fireEvent.scroll(transcript);

    const userEntry = {
      id: 'new-user-turn',
      kind: 'message' as const,
      role: 'user' as const,
      content: 'Show me the latest posts',
    };
    rerender(
      <AgentSurface
        connection={connected}
        entries={[
          {
            id: 'first-response',
            kind: 'message',
            role: 'assistant',
            content: 'First response',
          },
          userEntry,
        ]}
        isRunning
        onSubmit={vi.fn()}
      />,
    );
    expect(scrollIntoView).toHaveBeenCalledOnce();

    scrollIntoView.mockClear();
    transcript.scrollTop = 100;
    fireEvent.scroll(transcript);
    rerender(
      <AgentSurface
        connection={connected}
        entries={[
          {
            id: 'first-response',
            kind: 'message',
            role: 'assistant',
            content: 'First response',
          },
          userEntry,
          {
            id: 'streaming-response',
            kind: 'message',
            role: 'assistant',
            content: 'I found',
            streaming: true,
          },
        ]}
        isRunning
        onSubmit={vi.fn()}
      />,
    );
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('keeps OpenAI configuration out of the per-user connection flow', async () => {
    const user = userEvent.setup();
    const onConnectDatoCms = vi.fn();
    const setupConnection: AgentConnectionViewModel = {
      status: 'setup',
      openAiConfigStatus: 'missing',
      datoCmsStatus: 'disconnected',
    };

    const { rerender } = renderInCanvas(
      <AgentSurface
        connection={setupConnection}
        entries={[]}
        onConnectDatoCms={onConnectDatoCms}
        onSubmit={vi.fn()}
      />,
    );

    // Before DatoCMS is connected, the connection is the whole frame, with
    // what the agent is for in the help of its title
    expect(screen.getByText('Connect your DatoCMS account')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'About this page' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'New chat' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Back to chat' }),
    ).not.toBeInTheDocument();
    const provider = screen.getByText('Model provider').nextElementSibling;
    expect(provider).toHaveTextContent('OpenAI');
    expect(provider).toHaveTextContent('Setup required');
    // Who sets it up is visible text, not only a tooltip
    expect(
      screen.getByText(
        'Ask a project admin to set it up in the plugin settings.',
      ),
    ).toBeVisible();
    expect(screen.getByText('Not connected')).toBeVisible();
    expect(screen.queryByLabelText('API key')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('switch', {
        name: 'Remember credentials on this device',
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(
      'select only the project where this plugin is installed',
    );
    // The connection is the whole view: no panel that could hide it
    expect(
      screen.queryByRole('button', { name: 'Connection' }),
    ).not.toBeInTheDocument();
    rerender(
      <AgentSurface
        connection={{ ...setupConnection, projectName: 'Acme Magazine' }}
        entries={[]}
        onConnectDatoCms={onConnectDatoCms}
        onSubmit={vi.fn()}
      />,
    );
    // The project to allow is named
    expect(screen.getByRole('note')).toHaveTextContent(
      'When DatoCMS asks which projects to allow, select only Acme Magazine.',
    );

    // The action that changes the connection is in its row
    expect(screen.getByText('Not connected').closest('dd')).toContainElement(
      screen.getByRole('button', { name: 'Connect' }),
    );
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(onConnectDatoCms).toHaveBeenCalledOnce();

    const onDisconnectDatoCms = vi.fn();
    rerender(
      <AgentSurface
        connection={connected}
        entries={[
          {
            id: 'message',
            kind: 'message',
            role: 'user',
            content: 'Hello',
          },
        ]}
        onDisconnectDatoCms={onDisconnectDatoCms}
        onSubmit={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Open chats' }));
    expect(screen.getByRole('button', { name: 'Back to chat' })).toBeVisible();
    // Without chats, the focus goes to the title of the Connection panel. A
    // connection where all is well starts closed: the chats come first.
    const connectionTitle = screen.getByRole('button', { name: 'Connection' });
    expect(connectionTitle).toHaveFocus();
    expect(connectionTitle.closest('h2')).not.toBeNull();
    expect(connectionTitle).toHaveAttribute('aria-expanded', 'false');
    await user.click(connectionTitle);
    expect(
      screen.getByText('Marketing website').nextElementSibling,
    ).toHaveTextContent('Connected');
    expect(screen.queryByText('Remote MCP connection')).not.toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('API key')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Connect' }),
    ).not.toBeInTheDocument();
    // Disconnect changes the value: it is in the menu of the value, not a
    // standing button
    expect(
      screen.queryByRole('button', { name: 'Disconnect' }),
    ).not.toBeInTheDocument();
    const connectedValue = screen.getByRole('button', { name: 'Connected' });
    expect(connectedValue.closest('dd')).not.toBeNull();
    await user.click(connectedValue);
    await user.click(screen.getByRole('menuitem', { name: 'Disconnect' }));
    expect(onDisconnectDatoCms).toHaveBeenCalledOnce();
  });

  it('shows only six provided recent chats, and none before DatoCMS is connected', async () => {
    const user = userEvent.setup();
    const setupConnection: AgentConnectionViewModel = {
      status: 'setup',
      openAiConfigStatus: 'configured',
      datoCmsStatus: 'disconnected',
    };

    const { rerender } = renderInCanvas(
      <AgentSurface
        connection={setupConnection}
        entries={[]}
        onConnectDatoCms={vi.fn()}
        onSelectConversation={vi.fn()}
        onStartNewChat={vi.fn()}
        onSubmit={vi.fn()}
        recentConversations={recentConversations}
      />,
    );

    // A chat can't open before DatoCMS is connected: only the connection
    // shows
    expect(
      screen.queryByRole('heading', { name: /^Chats/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'New chat' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeVisible();

    rerender(
      <AgentSurface
        connection={connected}
        entries={[]}
        onSelectConversation={vi.fn()}
        onStartNewChat={vi.fn()}
        onSubmit={vi.fn()}
        recentConversations={recentConversations}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Open chats' }));
    // The focus goes to the first chat: the list comes before the connection
    expect(chatRow('Describe this project')).toHaveFocus();

    // The title of the toolbar already says Chats: no panel says it again,
    // and the chats come first, before the connection
    expect(
      screen.queryByRole('heading', { name: /^Chats/ }),
    ).not.toBeInTheDocument();
    expect(
      screen
        .getByText('Describe this project')
        .compareDocumentPosition(
          screen.getByRole('heading', { name: 'Connection' }),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(chatRow('Describe this project')).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(chatRow('Update the homepage')).not.toHaveAttribute('aria-current');
    expect(screen.getByText('Update the homepage')).toBeVisible();
    expect(screen.getByText('Find draft articles')).toBeVisible();
    expect(screen.getByText('Review campaign assets')).toBeVisible();
    expect(screen.getByText('Summarize recent changes')).toBeVisible();
    expect(screen.getByText('Check product descriptions')).toBeVisible();
    expect(
      screen.queryByText('This project contains landing pages and articles.'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Just now')).not.toBeInTheDocument();
    expect(screen.queryByText('Current')).not.toBeInTheDocument();
    expect(
      screen.queryByText('This chat is outside the six-item limit'),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New chat' })).toHaveTextContent(
      'New chat',
    );
  });

  it('closes connected settings after selecting or starting a chat', async () => {
    const user = userEvent.setup();
    const onSelectConversation = vi.fn();
    const onStartNewChat = vi.fn();

    renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[]}
        onSelectConversation={onSelectConversation}
        onStartNewChat={onStartNewChat}
        onSubmit={vi.fn()}
        recentConversations={recentConversations}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Open chats' }));
    await user.click(chatRow('Update the homepage') as HTMLElement);
    expect(onSelectConversation).toHaveBeenCalledWith(recentConversations[1]);
    expect(
      screen.getByRole('textbox', { name: 'Message the DatoCMS agent' }),
    ).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Open chats' }));
    expect(
      screen.queryByRole('button', { name: 'Clear conversation' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New chat' }));
    expect(onStartNewChat).toHaveBeenCalledOnce();
    expect(
      screen.getByRole('textbox', { name: 'Message the DatoCMS agent' }),
    ).toHaveFocus();
  });

  it('leaves the connected chat list with Back or Escape', async () => {
    const user = userEvent.setup();

    renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[]}
        onSubmit={vi.fn()}
        recentConversations={recentConversations}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Open chats' }));
    await user.click(screen.getByRole('button', { name: 'Back to chat' }));
    expect(
      screen.getByRole('textbox', { name: 'Message the DatoCMS agent' }),
    ).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Open chats' }));
    // Escape is an action of the view; the actions of the kit read the
    // physical key of the event
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
      code: 'Escape',
    });
    expect(
      screen.getByRole('textbox', { name: 'Message the DatoCMS agent' }),
    ).toHaveFocus();
  });

  it('keeps connected settings open when starting a chat is blocked', async () => {
    const user = userEvent.setup();

    renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[]}
        onStartNewChat={() => false}
        onSubmit={vi.fn()}
        recentConversations={recentConversations}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Open chats' }));
    await user.click(screen.getByRole('button', { name: 'New chat' }));
    expect(screen.getByRole('heading', { name: 'Connection' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Back to chat' })).toBeVisible();
  });

  it('shows a spinner while a chat opens, keeping the focus on its control', async () => {
    const user = userEvent.setup();
    let finishSwitch: (completed: boolean) => void = () => {};
    const onSelectConversation = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishSwitch = resolve;
        }),
    );
    let finishNewChat: (completed: boolean) => void = () => {};
    const onStartNewChat = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishNewChat = resolve;
        }),
    );

    renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[]}
        onSelectConversation={onSelectConversation}
        onStartNewChat={onStartNewChat}
        onSubmit={vi.fn()}
        recentConversations={recentConversations}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Open chats' }));
    const row = chatRow('Update the homepage') as HTMLElement;
    await user.click(row);
    // The opening chat shows a spinner; the row stays and keeps the focus
    expect(within(row).getByRole('status')).toHaveTextContent('Opening chat');
    expect(row).toHaveFocus();
    // More clicks wait for the switch
    await user.click(chatRow('Describe this project') as HTMLElement);
    await user.click(screen.getByRole('button', { name: 'New chat' }));
    expect(onSelectConversation).toHaveBeenCalledOnce();
    expect(onStartNewChat).not.toHaveBeenCalled();

    // A refused switch keeps the view, without the spinner
    await act(async () => finishSwitch(false));
    expect(within(row).queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: 'Back to chat' })).toBeVisible();

    // A new chat that starts shows the spinner of the bar; the button stays
    const newChat = screen.getByRole('button', { name: 'New chat' });
    await user.click(newChat);
    expect(onStartNewChat).toHaveBeenCalledOnce();
    expect(newChat).toBeEnabled();
    expect(newChat).not.toHaveAttribute('aria-busy');
    expect(document.querySelector('.Toolbar__spinner')).toHaveTextContent(
      'Loading',
    );
    await act(async () => finishNewChat(false));
    expect(document.querySelector('.Toolbar__spinner')).toBeNull();
  });

  it('hides chat history actions while the connection is in progress', () => {
    const connecting: AgentConnectionViewModel = {
      status: 'connecting',
      openAiConfigStatus: 'configured',
      datoCmsStatus: 'connecting',
    };

    renderInCanvas(
      <AgentSurface
        connection={connecting}
        entries={[]}
        onSelectConversation={vi.fn()}
        onStartNewChat={vi.fn()}
        onSubmit={vi.fn()}
        recentConversations={recentConversations}
      />,
    );

    // A chat can't open while the connection runs: no chats, no New chat
    expect(
      screen.queryByRole('button', { name: 'New chat' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Describe this project')).not.toBeInTheDocument();
    expect(screen.getByText('Connecting…')).toHaveRole('status');
    expect(
      screen.queryByRole('button', { name: 'Connect' }),
    ).not.toBeInTheDocument();
  });

  it('keeps the session-wide auto-approve control inside the chat', async () => {
    const user = userEvent.setup();
    const onAutoApproveChange = vi.fn();
    const { rerender } = renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[]}
        onAutoApproveChange={onAutoApproveChange}
        onSelectConversation={vi.fn()}
        onSubmit={vi.fn()}
        recentConversations={recentConversations}
      />,
    );

    const enableButton = autoApproveToggle();
    const chatListButton = screen.getByRole('button', { name: 'Open chats' });
    // One bar: the title of the chat, then Auto and the chats at the right
    expect(enableButton.parentElement).toBe(chatListButton.parentElement);
    expect(
      enableButton.compareDocumentPosition(chatListButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText('Describe this project')).toBeVisible();
    expect(enableButton).toHaveAttribute('aria-pressed', 'false');
    expect(enableButton).toHaveTextContent('Auto');
    expect(enableButton).not.toHaveTextContent('On');
    // The hint says what auto-approve does, not the label again
    expect(tooltipOf(enableButton)).toHaveTextContent(
      'When on, changes run without asking you first.',
    );
    await user.click(enableButton);
    expect(onAutoApproveChange).toHaveBeenCalledWith(true);

    await user.click(screen.getByRole('button', { name: 'Open chats' }));
    expect(
      screen.queryByRole('button', { name: /^Auto/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('switch', { name: 'Auto-approve' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to chat' })).toBeVisible();
    await user.click(chatRow('Describe this project') as HTMLElement);

    rerender(
      <AgentSurface
        autoApproveEnabled
        connection={connected}
        entries={[]}
        onAutoApproveChange={onAutoApproveChange}
        onSubmit={vi.fn()}
      />,
    );
    const disableButton = autoApproveToggle();
    expect(disableButton).toHaveAttribute('aria-pressed', 'true');
    expect(disableButton).toHaveTextContent('Auto');
    expect(disableButton).toHaveTextContent('On');
    // Changes run without review: the state is marked as the risk it is
    expect(within(disableButton).getByText('On').closest('.Pill')).toHaveClass(
      'Pill--warning',
    );
    expect(tooltipOf(disableButton)).toHaveTextContent(
      'When on, changes run without asking you first.',
    );
    await user.click(disableButton);
    expect(onAutoApproveChange).toHaveBeenLastCalledWith(false);
  });

  it('prevents repeated auto-approve activation while confirmation is open', () => {
    renderInCanvas(
      <AgentSurface
        autoApproveChanging
        connection={connected}
        entries={[]}
        onAutoApproveChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    const toggle = autoApproveToggle();
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute('aria-busy', 'true');
    // While the confirm is open, the chats wait for it
    expect(screen.getByRole('button', { name: 'Open chats' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('explains why auto-approve is unavailable in Read Only mode', async () => {
    const user = userEvent.setup();
    const onAutoApproveChange = vi.fn();
    renderInCanvas(
      <AgentSurface
        autoApproveDisabledReason="Auto-approve is unavailable in Read Only mode."
        connection={connected}
        entries={[]}
        onAutoApproveChange={onAutoApproveChange}
        onSubmit={vi.fn()}
      />,
    );

    const control = autoApproveToggle();
    expect(control).toHaveAttribute('aria-disabled', 'true');
    expect(control).toHaveAttribute('aria-pressed', 'false');
    expect(tooltipOf(control)).toHaveTextContent(
      'Auto-approve is unavailable in Read Only mode.',
    );
    await user.click(control);
    expect(onAutoApproveChange).not.toHaveBeenCalled();
  });

  it('hides automatic approval cards unless automatic execution fails', () => {
    const automaticApproval: UnsafeApprovalViewModel = {
      id: 'automatic',
      title: 'Review this change',
      description: 'Run the prepared operation.',
      actionLabel: 'Approve',
      status: 'approving',
      automatic: true,
    };
    const { rerender } = renderInCanvas(
      <AgentSurface
        autoApproveEnabled
        connection={connected}
        entries={[
          {
            id: 'automatic-entry',
            kind: 'approval',
            approval: automaticApproval,
          },
        ]}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.queryByText('Review this change')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Approve' }),
    ).not.toBeInTheDocument();

    rerender(
      <AgentSurface
        autoApproveEnabled
        connection={connected}
        entries={[
          {
            id: 'automatic-entry',
            kind: 'approval',
            approval: {
              ...automaticApproval,
              status: 'error',
              error: 'The result could not be confirmed.',
            },
          },
        ]}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText('Review this change')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The result could not be confirmed.',
    );
  });

  it('returns focus to the composer when leaving the chat list', async () => {
    const user = userEvent.setup();

    renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[]}
        onSelectConversation={vi.fn()}
        onSubmit={vi.fn()}
        recentConversations={recentConversations}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Open chats' }));
    await user.click(chatRow('Describe this project') as HTMLElement);
    expect(
      screen.getByRole('textbox', { name: 'Message the DatoCMS agent' }),
    ).toHaveFocus();
  });

  it('keeps connection settings unavailable while an approval is pending', async () => {
    const user = userEvent.setup();
    renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[
          {
            id: 'pending-approval',
            kind: 'approval',
            approval: {
              id: 'approval',
              title: 'Review this change',
              description: 'Run the prepared operation.',
              actionLabel: 'Approve',
              status: 'pending',
            },
          },
        ]}
        onSubmit={vi.fn()}
      />,
    );

    const openChats = screen.getByRole('button', { name: 'Open chats' });
    expect(openChats).toHaveAttribute('aria-disabled', 'true');
    expect(tooltipOf(openChats)).toHaveTextContent(
      'Approve or deny the proposed change first.',
    );
    await user.click(openChats);
    expect(
      screen.queryByRole('button', { name: 'Back to chat' }),
    ).not.toBeInTheDocument();
  });

  it('does not steal focus when a turn that started elsewhere finishes', () => {
    const { rerender } = renderInCanvas(
      <>
        <button type="button">Outside action</button>
        <AgentSurface
          connection={connected}
          entries={[]}
          isRunning
          onSubmit={vi.fn()}
        />
      </>,
    );

    const outside = screen.getByRole('button', { name: 'Outside action' });
    outside.focus();

    rerender(
      <>
        <button type="button">Outside action</button>
        <AgentSurface
          connection={connected}
          entries={[]}
          isRunning={false}
          onSubmit={vi.fn()}
        />
      </>,
    );

    expect(outside).toHaveFocus();
  });

  it('restores composer focus after a composer-submitted turn finishes', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { rerender } = renderInCanvas(
      <AgentSurface connection={connected} entries={[]} onSubmit={onSubmit} />,
    );

    const composer = screen.getByRole('textbox', {
      name: 'Message the DatoCMS agent',
    });
    await user.click(composer);
    await user.keyboard('Tell me about this page{Enter}');

    rerender(
      <AgentSurface
        connection={connected}
        entries={[]}
        isRunning
        onSubmit={onSubmit}
      />,
    );
    rerender(
      <AgentSurface
        connection={connected}
        entries={[]}
        isRunning={false}
        onSubmit={onSubmit}
      />,
    );

    expect(
      screen.getByRole('textbox', { name: 'Message the DatoCMS agent' }),
    ).toHaveFocus();
  });

  it('offers reconnection after confirmed MCP authentication failure', async () => {
    const onConnectDatoCms = vi.fn();
    const onRestartDatoCmsConnection = vi.fn();
    renderInCanvas(
      <AgentSurface
        connection={{
          ...connected,
          status: 'setup',
          datoCmsStatus: 'mcp_auth_required',
          projectName: 'Acme Magazine',
        }}
        entries={[]}
        onSubmit={vi.fn()}
        onConnectDatoCms={onConnectDatoCms}
        onRestartDatoCmsConnection={onRestartDatoCmsConnection}
      />,
    );
    // The row says it, so no error repeats it: the hint helps the next
    // sign-in
    expect(screen.getByText('Sign-in expired')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(
      'When DatoCMS asks which projects to allow, select only Acme Magazine.',
    );
    // A new sign-in that keeps the saved registration
    expect(
      screen.queryByRole('button', { name: 'More ways to connect' }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Connect again' }),
    );
    expect(onConnectDatoCms).toHaveBeenCalledOnce();
    expect(onRestartDatoCmsConnection).not.toHaveBeenCalled();
  });

  it('keeps reads available with a visible access retry when access is unknown', async () => {
    const onCheckDatoCmsAccess = vi.fn();
    renderInCanvas(
      <AgentSurface
        connection={{ ...connected, oauthAccessLevel: 'unknown' }}
        entries={[]}
        onSubmit={vi.fn()}
        onCheckDatoCmsAccess={onCheckDatoCmsAccess}
      />,
    );
    expect(
      screen.getByRole('textbox', { name: 'Message the DatoCMS agent' }),
    ).not.toHaveAttribute('aria-disabled', 'true');
    // A short title says the problem, the text what it means
    const notice = screen.getByRole('alert');
    expect(notice).toHaveTextContent('Couldn’t check your DatoCMS access');
    expect(notice).toHaveTextContent(
      'The agent can read content, but won’t make changes until you check again.',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Check access again' }),
    );
    expect(onCheckDatoCmsAccess).toHaveBeenCalledOnce();
  });

  it('says once what the agent can do, and how to give it more access', async () => {
    renderInCanvas(
      <AgentSurface
        connection={{
          ...connected,
          oauthAccessLevel: 'content_only',
          pluginReadOnly: true,
        }}
        entries={[]}
        onCheckDatoCmsAccess={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Open chats' }));
    // Read-only mode of the plugin wins, in the row of the access: the panel
    // is open, since the access is limited
    const access = screen.getByText('Access').nextElementSibling;
    expect(access).toHaveTextContent('Read content only');
    expect(access).toHaveTextContent(
      'Read-only mode is on in the plugin settings.',
    );
    expect(
      screen.queryByText(
        'Read-only mode is on, so the agent can’t change anything.',
      ),
    ).not.toBeInTheDocument();
    // Read-only mode is the one note: no way to allow more, no callout
    expect(
      screen.queryByRole('link', { name: 'Account settings' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Limited access')).not.toBeInTheDocument();
    expect(access).toContainElement(
      screen.getByRole('button', { name: 'Check access again' }),
    );
  });

  it.each([
    [
      'content_only' as const,
      'Read and edit content',
      'The agent can’t change models or settings. To allow more, remove its access in Account settings, then check access again.',
    ],
    [
      'content_view_only' as const,
      'Read content only',
      'To let the agent make changes, remove its access in Account settings, then check access again.',
    ],
  ])(
    'says in the access row how to allow more than %s',
    async (oauthAccessLevel, value, note) => {
      renderInCanvas(
        <AgentSurface
          connection={{ ...connected, oauthAccessLevel }}
          entries={[]}
          onCheckDatoCmsAccess={vi.fn()}
          onSubmit={vi.fn()}
        />,
      );
      await userEvent.click(screen.getByRole('button', { name: 'Open chats' }));

      // The limit is said once, in its row, with the button that follows
      const access = screen.getByText('Access').nextElementSibling;
      expect(access).toHaveTextContent(value);
      const link = screen.getByRole('link', { name: 'Account settings' });
      expect(link).toHaveAttribute(
        'href',
        'https://dashboard.datocms.com/personal-account/account',
      );
      expect(access).toContainElement(link);
      expect(link.parentElement).toHaveTextContent(note);
      expect(access).toContainElement(
        screen.getByRole('button', { name: 'Check access again' }),
      );
      expect(screen.queryByText('Limited access')).not.toBeInTheDocument();
    },
  );
  it('names the chat in the bar', () => {
    renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[]}
        onAutoApproveChange={vi.fn()}
        onSubmit={vi.fn()}
        recentConversations={[
          { id: 'untitled', title: '  ', isCurrent: true },
          { id: 'other', title: 'Another chat' },
        ]}
      />,
    );

    expect(screen.getByText('Untitled chat')).toBeVisible();
    expect(screen.queryByText('Another chat')).not.toBeInTheDocument();
  });

  it('explains on Send why the composer waits for a pending change', () => {
    renderInCanvas(
      <AgentSurface
        composerDisabled
        composerPlaceholder="Review the proposed change before continuing"
        connection={connected}
        entries={[
          {
            id: 'approval',
            kind: 'approval',
            approval: {
              id: 'approval',
              title: 'Update a record',
              description: 'Changes the title of one record.',
              actionLabel: 'Update',
              status: 'pending',
            },
          },
        ]}
        onSubmit={vi.fn()}
      />,
    );

    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toHaveAttribute('aria-disabled', 'true');
    expect(tooltipOf(send)).toHaveTextContent(
      'Approve or deny the proposed change first.',
    );
  });

  it('explains why the chats wait while the agent runs', () => {
    renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[]}
        isRunning
        onAutoApproveChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    const openChats = screen.getByRole('button', { name: 'Open chats' });
    expect(openChats).toHaveAttribute('aria-disabled', 'true');
    expect(tooltipOf(openChats)).toHaveTextContent(
      'Wait for the agent to finish.',
    );
    fireEvent.blur(openChats);

    const toggle = autoApproveToggle();
    expect(toggle).toHaveAttribute('aria-disabled', 'true');
    expect(tooltipOf(toggle)).toHaveTextContent(
      'Wait for the agent to finish.',
    );
  });

  it('offers one new sign-in after a connection error', async () => {
    const user = userEvent.setup();
    const onConnectDatoCms = vi.fn();
    const onRestartDatoCmsConnection = vi.fn();

    renderInCanvas(
      <AgentSurface
        connection={{
          status: 'error',
          providerConfigStatus: 'configured',
          providerLabel: 'Anthropic (Claude)',
          datoCmsStatus: 'error',
          datoCmsError: 'The sign-in window was closed.',
        }}
        entries={[]}
        onConnectDatoCms={onConnectDatoCms}
        onRestartDatoCmsConnection={onRestartDatoCmsConnection}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText('Connection failed')).toBeVisible();
    // A provider that is set up needs no row
    expect(screen.queryByText('Model provider')).not.toBeInTheDocument();
    // The error is the one message: the authorization hint waits for the
    // next sign-in
    const error = screen.getByRole('alert');
    expect(error).toHaveTextContent('The sign-in window was closed.');
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    // One button, a new sign-in that keeps the saved registration. Its menu
    // can start over with a new registration.
    expect(
      screen.queryByRole('button', { name: 'Connect' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Start sign-in again' }),
    ).not.toBeInTheDocument();
    const connectAgain = screen.getByRole('button', { name: 'Connect again' });
    // The problem comes first, then the rows with the actions that fix it
    expect(
      error.compareDocumentPosition(connectAgain) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getByText('Connection failed').closest('dd'),
    ).toContainElement(connectAgain);
    await user.click(connectAgain);
    expect(onConnectDatoCms).toHaveBeenCalledOnce();
    expect(onRestartDatoCmsConnection).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole('button', { name: 'More ways to connect' }),
    );
    await user.click(
      screen.getByRole('menuitem', { name: 'Start over with a new sign-in' }),
    );
    expect(onRestartDatoCmsConnection).toHaveBeenCalledOnce();
    expect(onConnectDatoCms).toHaveBeenCalledOnce();
  });

  it('says when there are no chats yet', async () => {
    renderInCanvas(
      <AgentSurface
        connection={connected}
        entries={[]}
        onStartNewChat={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Open chats' }));
    expect(screen.getByText('No chats yet')).toBeVisible();
  });

  it('shows the access check of the connection as busy while it runs', () => {
    renderInCanvas(
      <AgentSurface
        connection={{
          ...connected,
          status: 'setup',
          oauthAccessLevel: 'unknown',
          accessChecking: true,
        }}
        entries={[]}
        onCheckDatoCmsAccess={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText('Access').nextElementSibling).toHaveTextContent(
      'Not checked',
    );
    const check = screen.getByRole('button', { name: 'Check access again' });
    // The re-check is in the row of the access
    expect(screen.getByText('Access').nextElementSibling).toContainElement(
      check,
    );
    expect(check).toHaveAttribute('aria-busy', 'true');
    expect(check).toBeDisabled();
  });
});
