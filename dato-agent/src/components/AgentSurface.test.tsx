import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_CONVERSATION_MESSAGE_CHARACTERS } from '../lib/conversations';
import type { AgentMentionHost } from '../lib/mentionHost';
import { fallbackAssetMention, fallbackRecordMention } from '../lib/mentions';
import {
  type AgentConnectionViewModel,
  type AgentConversationSummaryViewModel,
  AgentSurface,
  type UnsafeApprovalViewModel,
} from './AgentSurface';

vi.mock('datocms-react-ui', async (importOriginal) => {
  const original = await importOriginal<typeof import('datocms-react-ui')>();
  const PassThrough = ({ children }: { children?: ReactNode }) => children;

  return {
    ...original,
    Tooltip: PassThrough,
    TooltipContent: () => null,
    TooltipDelayGroup: PassThrough,
    TooltipTrigger: PassThrough,
  };
});

vi.hoisted(() => {
  globalThis.ResizeObserver = class {
    disconnect() {}
    observe() {}
    unobserve() {}
  } as typeof ResizeObserver;
});

const scrollIntoView = vi.fn();

Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  value: scrollIntoView,
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  scrollIntoView.mockClear();
});

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
    title: 'This chat is outside the three-item limit',
    updatedAtLabel: 'Monday',
  },
];

describe('AgentSurface', () => {
  it('starts minimal and sends on Enter without visible keyboard instructions', () => {
    const onSubmit = vi.fn();

    render(
      <AgentSurface connection={connected} entries={[]} onSubmit={onSubmit} />,
    );

    expect(screen.getByText('What can I help with?')).toBeVisible();
    expect(screen.queryByText('Dato Agent')).not.toBeInTheDocument();
    expect(screen.queryByText('Editorial sandbox')).not.toBeInTheDocument();
    expect(screen.queryByText('Ready')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Enter to send|Shift\+Enter/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Connection settings' }),
    ).toBeVisible();

    const composer = screen.getByRole('textbox', {
      name: 'Message the DatoCMS agent',
    });
    expect(composer).toHaveAttribute(
      'maxlength',
      String(MAX_CONVERSATION_MESSAGE_CHARACTERS),
    );
    const sendButton = screen.getByRole('button', { name: 'Send' });
    expect(sendButton).toHaveAttribute('title', 'Send');
    expect(sendButton).not.toHaveTextContent('Send');
    expect(sendButton.querySelector('svg')).not.toBeNull();
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
    render(
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

    render(
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
    expect(screen.getByText('Working…')).toBeVisible();
    const stopButton = screen.getByRole('button', { name: 'Stop' });
    expect(stopButton).toHaveAttribute('title', 'Stop');
    expect(stopButton).not.toHaveTextContent('Stop');
    expect(stopButton.querySelector('svg')).not.toBeNull();
    await user.click(stopButton);
    expect(onStop).toHaveBeenCalledOnce();
  });

  it('keeps recovered tool activity behind one quiet disclosure', async () => {
    const user = userEvent.setup();

    render(
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

    const summary = screen.getByText('DatoCMS activity');
    const disclosure = summary.closest('details');
    expect(disclosure).not.toHaveAttribute('open');
    expect(screen.queryByText('1 DatoCMS step failed')).not.toBeInTheDocument();

    await user.click(summary);
    expect(disclosure).toHaveAttribute('open');
    expect(screen.getByText('Reading the content model')).toBeVisible();
    expect(screen.getByText('Not completed')).toBeVisible();
    expect(screen.getByText('Replacement 1: String not found')).toBeVisible();
  });

  it('shows recoverable failures as ongoing work until the next step starts', () => {
    const { rerender } = render(
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
      screen.queryByRole('button', { name: 'Copy diagnostics' }),
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
    render(
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

    expect(screen.getByText('DatoCMS activity')).toBeVisible();
    expect(screen.getByText('Working…')).toBeVisible();
    expect(
      screen.queryByText('Trying another approach…'),
    ).not.toBeInTheDocument();
  });

  it('reserves terminal failure copy for a failed overall turn', () => {
    render(
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

    expect(screen.getByText('Couldn’t complete this request')).toBeVisible();
  });

  it('requires explicit approval for content changes and renders code exactly', async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const onReview = vi.fn();
    const approval: UnsafeApprovalViewModel = {
      id: 'approval-1',
      title: 'Update three article titles',
      description: 'This will change the title field on three records.',
      actionLabel: 'Run title normalization',
      details: [
        {
          label: 'Generated TypeScript',
          value: 'await client.items.update("123", { title: "Hello" });',
        },
      ],
      status: 'pending',
    };

    render(
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

    render(
      <AgentSurface
        connection={connected}
        entries={[{ id: 'entry-progress', kind: 'approval', approval }]}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText('Approving…')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Approve' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Deny' }),
    ).not.toBeInTheDocument();
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

    render(
      <AgentSurface
        connection={connected}
        entries={[{ id: 'entry-error', kind: 'approval', approval }]}
        onApproveUnsafeAction={vi.fn()}
        onRejectUnsafeAction={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText('Approval could not be recorded.')).toHaveRole(
      'alert',
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

    render(
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

  it('keeps every record in a multi-record result individually accessible', async () => {
    const user = userEvent.setup();
    const onOpenRecord = vi.fn();

    render(
      <AgentSurface
        connection={connected}
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

    const receipt = screen.getByLabelText('Matching articles');
    expect(
      within(receipt).getByRole('button', { name: 'Open One' }),
    ).toBeVisible();
    expect(
      within(receipt).getByRole('button', { name: 'Open Two' }),
    ).toBeVisible();
    await user.click(within(receipt).getByRole('button', { name: 'Open Two' }));
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

    render(
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

  it('visibly disables inline mentions while the agent is working', async () => {
    const user = userEvent.setup();
    const onOpenRecord = vi.fn();

    render(
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
    expect(mention).toBeDisabled();
    await user.click(mention);
    expect(onOpenRecord).not.toHaveBeenCalled();
  });

  it('disables record results while the agent is still running', async () => {
    const user = userEvent.setup();
    const onOpenRecord = vi.fn();

    render(
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

    const openButton = screen.getByRole('button', { name: 'Open One' });
    expect(openButton).toBeDisabled();
    await user.click(openButton);
    expect(onOpenRecord).not.toHaveBeenCalled();
  });

  it('disables a record receipt while its modal is opening', () => {
    render(
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
        onOpenRecord={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Records')).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Open One' })).toBeDisabled();
  });

  it('keeps tool-only records in an accessible agent turn', () => {
    render(
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

    const agentTurn = screen.getByRole('article', { name: 'Dato agent' });
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

    render(
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

    const agentTurns = screen.getAllByRole('article', { name: 'Dato agent' });
    expect(agentTurns).toHaveLength(1);
    const agentTurn = agentTurns[0];
    expect(within(agentTurn).getByText('Waiting for approval')).toBeVisible();
    expect(within(agentTurn).getByLabelText('Homepage')).toBeVisible();
    expect(
      within(agentTurn).getByRole('group', { name: 'Publish Homepage' }),
    ).toBeVisible();
    expect(
      within(agentTurn).getByText('The Homepage is ready for approval.'),
    ).toBeVisible();
  });

  it('starts a fresh agent turn after each user message', () => {
    render(
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

    expect(screen.getAllByRole('article', { name: 'Dato agent' })).toHaveLength(
      2,
    );
  });

  it('separates user and agent turns without visible identity headers', () => {
    render(
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
    const agentTurn = screen.getByRole('article', { name: 'Dato agent' });
    expect(userTurn.className).not.toBe(agentTurn.className);
    expect(within(userTurn).queryByText('Dato Agent')).not.toBeInTheDocument();
    expect(within(agentTurn).queryByText('Dato Agent')).not.toBeInTheDocument();
    expect(userTurn.querySelector('img, time')).toBeNull();
    expect(agentTurn.querySelector('img, time')).toBeNull();
  });

  it('shows a compact navigation error with its record results', () => {
    render(
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

    expect(
      screen.getByText('Could not open this record. Access denied.'),
    ).toHaveRole('alert');
  });

  it('renders compact clickable field and asset references', async () => {
    const user = userEvent.setup();
    const onOpenField = vi.fn();
    const onOpenAsset = vi.fn();

    render(
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
              { uploadId: 'upload-1', title: 'Hero.jpg' },
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

    const fields = screen.getByLabelText('Relevant fields');
    expect(within(fields).getByText('en')).toBeVisible();
    await user.click(
      within(fields).getByRole('button', { name: 'Show Title' }),
    );
    expect(onOpenField).toHaveBeenCalledWith(
      { fieldPath: 'title', title: 'Title', locale: 'en' },
      'fields',
    );

    const assets = screen.getByLabelText('Referenced assets');
    await user.click(
      within(assets).getByRole('button', { name: 'Open Hero.jpg' }),
    );
    expect(onOpenAsset).toHaveBeenCalledWith(
      { uploadId: 'upload-1', title: 'Hero.jpg' },
      'assets',
    );
    expect(
      within(assets).getByRole('button', { name: 'Open Old.jpg' }),
    ).toBeDisabled();
    expect(within(assets).getByText('Deleted')).toBeVisible();
  });

  it('locks every clickable receipt while a host UI action is pending', () => {
    const approval: UnsafeApprovalViewModel = {
      id: 'approval',
      title: 'Review this change',
      description: 'Review generated details.',
      actionLabel: 'Approve',
      details: [{ label: 'Target', value: 'Homepage' }],
      status: 'pending',
    };

    render(
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
        onAutoApproveChange={vi.fn()}
        onOpenAsset={vi.fn()}
        onOpenField={vi.fn()}
        onOpenRecord={vi.fn()}
        onRejectUnsafeAction={vi.fn()}
        onReviewUnsafeAction={vi.fn()}
        onSubmit={vi.fn()}
        hostActionPending
      />,
    );

    expect(screen.getByRole('button', { name: 'Open Record' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Show Title' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Open Hero.jpg' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Review details' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Turn on auto-approve' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Connection settings' }),
    ).toBeDisabled();
  });

  it('shows partial responses together with string errors', () => {
    render(
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
    expect(
      screen.getByText('The connection closed before the response finished.'),
    ).toHaveRole('alert');
    expect(screen.getByText('The request could not be completed.')).toHaveRole(
      'alert',
    );
    expect(
      screen.getByText('A partial response restored from history.'),
    ).toBeVisible();
    expect(screen.getByText('The response was interrupted.')).toHaveRole(
      'alert',
    );
    expect(
      screen.queryByRole('button', { name: 'Try again' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Copy diagnostics' }),
    ).not.toBeInTheDocument();
  });

  it('offers compact recovery actions only for a terminal assistant failure', async () => {
    const onRetryFailedTurn = vi.fn();
    const onCopyFailureDiagnostics = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
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
      name: 'Copy diagnostics',
    });
    expect(retryButton.querySelector('svg')).not.toBeNull();
    expect(copyButton.querySelector('svg')).not.toBeNull();
    expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(
      1,
    );
    expect(
      screen.getAllByRole('button', { name: 'Copy diagnostics' }),
    ).toHaveLength(1);

    await user.click(retryButton);
    expect(onRetryFailedTurn).toHaveBeenCalledOnce();
    expect(onRetryFailedTurn).toHaveBeenCalledWith('failure-1');

    await user.click(copyButton);
    expect(onCopyFailureDiagnostics).toHaveBeenCalledOnce();
    expect(onCopyFailureDiagnostics).toHaveBeenCalledWith('failure-1');
  });

  it('shows only diagnostics for a non-retryable terminal failure', () => {
    render(
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
      screen.getByRole('button', { name: 'Copy diagnostics' }),
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

    render(
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

    expect(
      screen.getByRole('button', { name: 'Trying again…' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Copy diagnostics' }),
    ).toBeDisabled();

    await act(async () => {
      resolveRetry?.();
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Copy diagnostics' }),
    ).toBeEnabled();
  });

  it('announces copied diagnostics briefly and reports copy failures inline', async () => {
    vi.useFakeTimers();
    const onCopyFailureDiagnostics = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Clipboard unavailable'));

    render(
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
      fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }));
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: 'Copied' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Diagnostics copied');

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(
      screen.getByRole('button', { name: 'Copy diagnostics' }),
    ).toBeVisible();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }));
      await Promise.resolve();
    });

    expect(screen.getByText('Couldn’t copy diagnostics')).toHaveRole('alert');
    expect(
      screen.getByRole('button', { name: 'Copy diagnostics' }),
    ).toBeEnabled();
  });

  it('only follows transcript updates while the reader is near the bottom', () => {
    const { rerender } = render(
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

  it('keeps OpenAI configuration out of the per-user connection flow', async () => {
    const user = userEvent.setup();
    const onConnectDatoCms = vi.fn();
    const setupConnection: AgentConnectionViewModel = {
      status: 'setup',
      openAiConfigStatus: 'missing',
      datoCmsStatus: 'disconnected',
    };

    const { rerender } = render(
      <AgentSurface
        connection={setupConnection}
        entries={[]}
        onConnectDatoCms={onConnectDatoCms}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText('OpenAI setup required')).toBeVisible();
    expect(screen.queryByLabelText('API key')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('switch', {
        name: 'Remember credentials on this device',
      }),
    ).not.toBeInTheDocument();

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

    await user.click(
      screen.getByRole('button', { name: 'Connection settings' }),
    );
    expect(screen.getByRole('heading', { name: 'Connection' })).toHaveFocus();
    expect(screen.getByText('Marketing website')).toBeVisible();
    expect(screen.getByRole('img', { name: 'Connected' })).toBeVisible();
    expect(screen.queryByText('Remote MCP connection')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('API key')).not.toBeInTheDocument();
    const disconnectButton = screen.getByRole('button', {
      name: 'Disconnect DatoCMS',
    });
    expect(disconnectButton).toHaveTextContent('');
    expect(within(disconnectButton).queryByRole('img')).not.toBeInTheDocument();
    await user.click(disconnectButton);
    expect(onDisconnectDatoCms).toHaveBeenCalledOnce();
  });

  it('shows only three provided recent chats on the connection page', async () => {
    const user = userEvent.setup();
    const onSelectConversation = vi.fn();
    const onStartNewChat = vi.fn();
    const setupConnection: AgentConnectionViewModel = {
      status: 'setup',
      openAiConfigStatus: 'configured',
      datoCmsStatus: 'disconnected',
    };

    render(
      <AgentSurface
        connection={setupConnection}
        entries={[]}
        onSelectConversation={onSelectConversation}
        onStartNewChat={onStartNewChat}
        onSubmit={vi.fn()}
        recentConversations={recentConversations}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Chats' })).toBeVisible();
    const currentChat = screen
      .getByText('Describe this project')
      .closest('button');
    expect(currentChat).toHaveAttribute('aria-current', 'page');
    expect(currentChat).toHaveAttribute('title', 'Describe this project');
    expect(
      within(currentChat as HTMLElement).getByRole('img', {
        name: 'Current chat',
      }),
    ).toBeVisible();
    expect(screen.getByText('Update the homepage')).toBeVisible();
    expect(screen.getByText('Find draft articles')).toBeVisible();
    expect(
      screen.queryByText('This project contains landing pages and articles.'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Just now')).not.toBeInTheDocument();
    expect(screen.queryByText('Current')).not.toBeInTheDocument();
    expect(
      screen.queryByText('This chat is outside the three-item limit'),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByText('Update the homepage').closest('button') as HTMLElement,
    );
    expect(onSelectConversation).toHaveBeenCalledWith(recentConversations[1]);
    expect(screen.getByRole('button', { name: 'Connect' })).toBeVisible();

    const newChatButton = screen.getByRole('button', { name: 'New chat' });
    expect(newChatButton).toHaveTextContent('');
    expect(within(newChatButton).queryByRole('img')).not.toBeInTheDocument();
    await user.click(newChatButton);
    expect(onStartNewChat).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeVisible();
  });

  it('closes connected settings after selecting or starting a chat', async () => {
    const user = userEvent.setup();
    const onSelectConversation = vi.fn();
    const onStartNewChat = vi.fn();

    render(
      <AgentSurface
        connection={connected}
        entries={[]}
        onSelectConversation={onSelectConversation}
        onStartNewChat={onStartNewChat}
        onSubmit={vi.fn()}
        recentConversations={recentConversations}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'Connection settings' }),
    );
    await user.click(
      screen.getByText('Update the homepage').closest('button') as HTMLElement,
    );
    expect(onSelectConversation).toHaveBeenCalledWith(recentConversations[1]);
    expect(
      screen.getByRole('textbox', { name: 'Message the DatoCMS agent' }),
    ).toHaveFocus();

    await user.click(
      screen.getByRole('button', { name: 'Connection settings' }),
    );
    expect(
      screen.queryByRole('button', { name: 'Clear conversation' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New chat' }));
    expect(onStartNewChat).toHaveBeenCalledOnce();
    expect(
      screen.getByRole('textbox', { name: 'Message the DatoCMS agent' }),
    ).toHaveFocus();
  });

  it('keeps connected settings open when starting a chat is blocked', async () => {
    const user = userEvent.setup();

    render(
      <AgentSurface
        connection={connected}
        entries={[]}
        onStartNewChat={() => false}
        onSubmit={vi.fn()}
        recentConversations={recentConversations}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'Connection settings' }),
    );
    await user.click(screen.getByRole('button', { name: 'New chat' }));
    expect(screen.getByRole('heading', { name: 'Connection' })).toBeVisible();
  });

  it('disables chat history actions while the connection is in progress', () => {
    const connecting: AgentConnectionViewModel = {
      status: 'connecting',
      openAiConfigStatus: 'configured',
      datoCmsStatus: 'connecting',
    };

    render(
      <AgentSurface
        connection={connecting}
        entries={[]}
        onSelectConversation={vi.fn()}
        onStartNewChat={vi.fn()}
        onSubmit={vi.fn()}
        recentConversations={recentConversations}
      />,
    );

    expect(screen.getByRole('button', { name: 'New chat' })).toBeDisabled();
    expect(
      screen.getByText('Describe this project').closest('button'),
    ).toBeDisabled();
  });

  it('keeps the session-wide auto-approve control inside the chat', async () => {
    const user = userEvent.setup();
    const onAutoApproveChange = vi.fn();
    const { rerender } = render(
      <AgentSurface
        connection={connected}
        entries={[]}
        onAutoApproveChange={onAutoApproveChange}
        onSubmit={vi.fn()}
      />,
    );

    const enableButton = screen.getByRole('button', {
      name: 'Turn on auto-approve',
    });
    expect(enableButton).toHaveAttribute('aria-pressed', 'false');
    expect(enableButton).toHaveTextContent('Auto');
    await user.click(enableButton);
    expect(onAutoApproveChange).toHaveBeenCalledWith(true);

    await user.click(
      screen.getByRole('button', { name: 'Connection settings' }),
    );
    expect(
      screen.queryByRole('button', { name: 'Turn on auto-approve' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('switch', { name: 'Auto-approve' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to chat' }));

    rerender(
      <AgentSurface
        autoApproveEnabled
        connection={connected}
        entries={[]}
        onAutoApproveChange={onAutoApproveChange}
        onSubmit={vi.fn()}
      />,
    );
    const disableButton = screen.getByRole('button', {
      name: 'Turn off auto-approve',
    });
    expect(disableButton).toHaveAttribute('aria-pressed', 'true');
    expect(disableButton).toHaveTextContent('Auto');
    await user.click(disableButton);
    expect(onAutoApproveChange).toHaveBeenLastCalledWith(false);
  });

  it('prevents repeated auto-approve activation while confirmation is open', () => {
    render(
      <AgentSurface
        autoApproveChanging
        connection={connected}
        entries={[]}
        onAutoApproveChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Confirming auto-approve' }),
    ).toBeDisabled();
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
    const { rerender } = render(
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
    expect(screen.getByText('The result could not be confirmed.')).toHaveRole(
      'alert',
    );
  });

  it('returns focus to the composer when leaving connection settings', async () => {
    const user = userEvent.setup();

    render(
      <AgentSurface connection={connected} entries={[]} onSubmit={vi.fn()} />,
    );

    await user.click(
      screen.getByRole('button', { name: 'Connection settings' }),
    );
    await user.click(screen.getByRole('button', { name: 'Back to chat' }));
    expect(
      screen.getByRole('textbox', { name: 'Message the DatoCMS agent' }),
    ).toHaveFocus();
  });

  it('keeps connection settings unavailable while an approval is pending', () => {
    render(
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

    expect(
      screen.getByRole('button', { name: 'Connection settings' }),
    ).toBeDisabled();
  });

  it('restores composer focus after a turn finishes', () => {
    const { rerender } = render(
      <AgentSurface
        connection={connected}
        entries={[]}
        isRunning
        onSubmit={vi.fn()}
      />,
    );

    rerender(
      <AgentSurface
        connection={connected}
        entries={[]}
        isRunning={false}
        onSubmit={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('textbox', { name: 'Message the DatoCMS agent' }),
    ).toHaveFocus();
  });
});
