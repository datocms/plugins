import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMentionHost } from '../../lib/mentionHost';
import {
  fallbackAssetMention,
  fallbackRecordMention,
} from '../../lib/mentions';
import { renderInCanvas } from '../../test/canvas';
import type {
  AgentTranscriptEntry,
  UnsafeApprovalViewModel,
} from '../AgentSurface';
import { Transcript, type TranscriptProps } from './Transcript';

function mentionHost(
  overrides: Partial<AgentMentionHost> = {},
): AgentMentionHost {
  return {
    currentUser: {
      id: 'current-user',
      name: 'Editor',
      email: 'editor@example.com',
      avatarUrl: null,
      userType: 'user',
    },
    projectOwnerId: 'project-owner',
    projectModels: [
      { id: 'page', apiKey: 'page', name: 'Page', isBlockModel: false },
    ],
    recordModels: [],
    canMentionFields: true,
    canMentionAssets: true,
    canMentionModels: true,
    loadProjectUsers: async () => [],
    selectAsset: async () => undefined,
    selectRecord: async () => undefined,
    resolveAsset: async ({ uploadId, label }) =>
      fallbackAssetMention(uploadId, label || `Asset #${uploadId}`),
    resolveRecord: async ({ itemId, label }) =>
      fallbackRecordMention({
        id: itemId,
        title: label || `Record #${itemId}`,
      }),
    openUser: vi.fn(),
    openModel: vi.fn(),
    openLocalFile: vi.fn(async () => undefined),
    ...overrides,
  };
}

function renderTranscript(
  entries: readonly AgentTranscriptEntry[],
  props: Partial<TranscriptProps> = {},
) {
  const view = renderInCanvas(
    <Transcript entries={entries} mentionHost={mentionHost()} {...props} />,
  );

  return {
    ...view,
    rerenderTranscript: (
      nextEntries: readonly AgentTranscriptEntry[],
      nextProps: Partial<TranscriptProps> = {},
    ) =>
      view.rerender(
        <Transcript
          entries={nextEntries}
          mentionHost={mentionHost()}
          {...props}
          {...nextProps}
        />,
      ),
  };
}

const pendingApproval: UnsafeApprovalViewModel = {
  id: 'approval',
  title: 'Update three article titles',
  description: 'This will change the title field on three records.',
  actionLabel: 'Update titles',
  script: { language: 'typescript', source: 'await client.items.list();' },
  status: 'pending',
};

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

describe('Transcript', () => {
  it('says what is missing in an empty conversation and how to start', () => {
    renderTranscript([]);

    const log = screen.getByRole('log');
    expect(log).toHaveTextContent('No messages yet');
    expect(log).toHaveTextContent(
      'Ask the agent to find, create or update content.',
    );
    // No keyboard instructions: the insert toolbar offers the references
    expect(log).not.toHaveTextContent(/Type \//);
  });

  it('groups each user message and the agent turn after it', () => {
    renderTranscript([
      { id: 'u1', kind: 'message', role: 'user', content: 'First' },
      { id: 'a1', kind: 'message', role: 'assistant', content: 'One' },
      {
        id: 'r1',
        kind: 'records',
        title: 'Useful record',
        records: [{ itemId: 'home', title: 'Home' }],
      },
      { id: 'u2', kind: 'message', role: 'user', content: 'Second' },
      { id: 'a2', kind: 'message', role: 'assistant', content: 'Two' },
    ]);

    expect(screen.getAllByRole('article', { name: 'You' })).toHaveLength(2);
    const turns = screen.getAllByRole('article', { name: 'Dato Agent' });
    expect(turns).toHaveLength(2);
    expect(within(turns[0]).getByText('One')).toBeVisible();
    expect(
      within(turns[0]).getByRole('group', { name: 'Useful record' }),
    ).toBeVisible();
    expect(turns[0].querySelector('img, time')).toBeNull();
  });

  it('says Stopped once for a stopped turn', () => {
    renderTranscript([
      {
        id: 'activity',
        kind: 'activity',
        phase: 'cancelled',
        activities: [{ id: 'step', label: 'Thinking', status: 'cancelled' }],
      },
      {
        id: 'assistant',
        kind: 'message',
        role: 'assistant',
        content: 'Stopped.',
        interrupted: true,
      },
    ]);

    expect(screen.getAllByText('Stopped')).toHaveLength(1);
  });

  it('keeps the steps of a turn behind one collapsed disclosure', async () => {
    const user = userEvent.setup();
    renderTranscript([
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
    ]);

    const toggle = screen.getByRole('button', { name: 'DatoCMS activity' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Not completed')).not.toBeVisible();

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Reading the content model')).toBeVisible();
    expect(screen.getByText('Not completed')).toBeVisible();
    expect(
      screen.getByRole('region', { name: 'Reading CMS content details' }),
    ).toHaveTextContent('Replacement 1: String not found');
  });

  it('shows the running step, or Working… before the first one', () => {
    const { rerenderTranscript } = renderTranscript(
      [{ id: 'activity', kind: 'activity', phase: 'running', activities: [] }],
      { isRunning: true },
    );

    expect(screen.getByRole('status')).toHaveTextContent('Working…');
    expect(screen.getByRole('log')).toHaveAttribute('aria-busy', 'true');

    rerenderTranscript([
      {
        id: 'activity',
        kind: 'activity',
        phase: 'running',
        activities: [
          { id: 'failed', label: 'Reading CMS content', status: 'error' },
          {
            id: 'retry',
            label: 'Checking another approach',
            status: 'running',
          },
        ],
      },
    ]);

    expect(
      screen.getByRole('button', { name: 'Checking another approach' }),
    ).toBeVisible();
  });

  it('opens each record of a receipt, except the record already open', async () => {
    const user = userEvent.setup();
    const onOpenRecord = vi.fn();
    renderTranscript(
      [
        {
          id: 'records',
          kind: 'records',
          title: 'Matching articles',
          records: [
            { itemId: 'one', itemTypeId: 'page', title: 'One' },
            { itemId: 'two', itemTypeId: 'page', title: 'Two' },
          ],
        },
      ],
      { currentRecordId: 'one', onOpenRecord },
    );

    const receipt = screen.getByRole('group', { name: 'Matching articles' });
    const current = within(receipt).getByText('Current record');
    expect(current.closest('[aria-current="true"]')).not.toBeNull();
    expect(within(receipt).getAllByRole('button')).toHaveLength(1);

    await user.click(within(receipt).getByRole('button', { name: /Two/ }));

    expect(onOpenRecord).toHaveBeenCalledWith(
      { itemId: 'two', itemTypeId: 'page', title: 'Two' },
      'records',
    );
    // The model is the kicker of each row
    expect(within(receipt).getAllByText('Page')).toHaveLength(2);
  });

  it('names an untitled record as such and tells it apart by its ID', () => {
    renderTranscript([
      {
        id: 'records',
        kind: 'records',
        records: [
          { itemId: 'rec-1', itemTypeId: 'page', title: '' },
          { itemId: 'rec-2', itemTypeId: 'page', title: 'Record #rec-2' },
        ],
      },
    ]);

    const receipt = screen.getByRole('group', { name: 'Records' });
    expect(within(receipt).getAllByText('Untitled record')).toHaveLength(2);
    expect(within(receipt).getByText('rec-1')).toBeVisible();
    expect(within(receipt).getByText('rec-2')).toBeVisible();
    expect(receipt).not.toHaveTextContent('#');
  });

  it('locks a receipt while its record opens and shows which one', async () => {
    const user = userEvent.setup();
    const onOpenRecord = vi.fn();
    const records: AgentTranscriptEntry = {
      id: 'records',
      kind: 'records',
      records: [{ itemId: 'one', title: 'One' }],
    };
    const { rerenderTranscript } = renderTranscript([records], {
      onOpenRecord,
    });

    await user.click(screen.getByRole('button', { name: /One/ }));
    expect(onOpenRecord).toHaveBeenCalledOnce();

    rerenderTranscript([{ ...records, opening: true }]);

    const receipt = screen.getByRole('group', { name: 'Records' });
    expect(receipt).toHaveAttribute('aria-busy', 'true');
    const row = within(receipt).getByRole('button', { name: /One/ });
    expect(row.querySelector('.Spinner')).not.toBeNull();
    await user.click(row);
    expect(onOpenRecord).toHaveBeenCalledOnce();
  });

  it('opens fields and live assets, and never a deleted asset', async () => {
    const user = userEvent.setup();
    const onOpenField = vi.fn();
    const onOpenAsset = vi.fn();
    renderTranscript(
      [
        {
          id: 'fields',
          kind: 'fields',
          title: 'Relevant fields',
          fields: [{ fieldPath: 'title', title: 'Title', locale: 'en' }],
        },
        {
          id: 'assets',
          kind: 'assets',
          title: 'Referenced assets',
          assets: [
            { uploadId: 'hero', title: 'Hero.jpg' },
            { uploadId: 'old', title: 'Old.jpg', deleted: true },
          ],
        },
      ],
      { onOpenAsset, onOpenField },
    );

    const fields = screen.getByRole('group', { name: 'Relevant fields' });
    expect(within(fields).getByText('en')).toBeVisible();
    await user.click(within(fields).getByRole('button', { name: /Title/ }));
    expect(onOpenField).toHaveBeenCalledWith(
      { fieldPath: 'title', title: 'Title', locale: 'en' },
      'fields',
    );

    const assets = screen.getByRole('group', { name: 'Referenced assets' });
    await user.click(within(assets).getByRole('button', { name: /Hero/ }));
    expect(onOpenAsset).toHaveBeenCalledWith(
      { uploadId: 'hero', title: 'Hero.jpg' },
      'assets',
    );
    expect(
      within(assets).queryByRole('button', { name: /Old/ }),
    ).not.toBeInTheDocument();
    expect(within(assets).getByText('Deleted')).toBeVisible();
  });

  it('opens the references of a user message, but not during a host action', async () => {
    const user = userEvent.setup();
    const onOpenRecord = vi.fn();
    const entries: AgentTranscriptEntry[] = [
      {
        id: 'user',
        kind: 'message',
        role: 'user',
        content: 'Open Homepage',
        segments: [
          { type: 'text', content: 'Open ' },
          {
            type: 'mention',
            mention: {
              type: 'record',
              id: 'home',
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
    ];
    const { rerenderTranscript } = renderTranscript(entries, { onOpenRecord });

    await user.click(screen.getByRole('button', { name: 'Homepage' }));
    expect(onOpenRecord).toHaveBeenCalledWith({
      itemId: 'home',
      itemTypeId: 'page',
      title: 'Homepage',
    });

    rerenderTranscript(entries, { hostActionPending: true });
    expect(
      screen.queryByRole('button', { name: 'Homepage' }),
    ).not.toBeInTheDocument();
  });

  it('asks for an explicit decision on a pending change', async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const onReview = vi.fn();
    renderTranscript(
      [{ id: 'approval', kind: 'approval', approval: pendingApproval }],
      {
        onApproveUnsafeAction: onApprove,
        onRejectUnsafeAction: onReject,
        onReviewUnsafeAction: onReview,
      },
    );

    const card = screen.getByRole('group', {
      name: 'Update three article titles',
    });
    // The card is named by its title, which is no heading: the frame is no
    // page or dialog
    expect(within(card).queryByRole('heading')).toBeNull();
    expect(within(card).getByText('Update three article titles')).toBeVisible();
    expect(card).not.toHaveTextContent('await client.items.list();');

    const review = within(card).getByRole('button', { name: 'Review details' });
    expect(review).toHaveAttribute('aria-haspopup', 'dialog');
    await user.click(review);
    expect(onReview).toHaveBeenCalledWith(pendingApproval);

    await user.click(within(card).getByRole('button', { name: 'Approve' }));
    expect(onApprove).toHaveBeenCalledWith(pendingApproval);
    await user.click(within(card).getByRole('button', { name: 'Deny' }));
    expect(onReject).toHaveBeenCalledWith(pendingApproval);
  });

  it('locks the decision while it saves, and ends a failed change', () => {
    const { rerenderTranscript } = renderTranscript(
      [
        {
          id: 'approval',
          kind: 'approval',
          approval: { ...pendingApproval, status: 'approving' },
        },
      ],
      { onApproveUnsafeAction: vi.fn(), onRejectUnsafeAction: vi.fn() },
    );

    expect(screen.getByRole('button', { name: 'Approve' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Deny' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByText('Approving…')).toHaveRole('status');

    rerenderTranscript([
      {
        id: 'approval',
        kind: 'approval',
        approval: {
          ...pendingApproval,
          status: 'error',
          error: 'Approval could not be recorded.',
        },
      },
    ]);

    expect(
      screen.getByText('Approval could not be recorded.').closest('.Callout'),
    ).toHaveAttribute('role', 'alert');
    expect(
      screen.queryByRole('button', { name: 'Approve' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Deny' }),
    ).not.toBeInTheDocument();
  });

  it('shrinks a decided change and hides quiet automatic approvals', () => {
    renderTranscript([
      {
        id: 'denied',
        kind: 'approval',
        approval: { ...pendingApproval, status: 'rejected' },
      },
      {
        id: 'automatic',
        kind: 'approval',
        approval: {
          ...pendingApproval,
          id: 'automatic',
          title: 'Automatic change',
          automatic: true,
          status: 'approved',
        },
      },
    ]);

    expect(screen.getByText('Denied. No action was taken.')).toHaveRole(
      'status',
    );
    expect(screen.queryByText('Automatic change')).not.toBeInTheDocument();
  });

  it('explains a failed change and offers the repair turn', async () => {
    const user = userEvent.setup();
    const onRepair = vi.fn();
    const approval: UnsafeApprovalViewModel = {
      ...pendingApproval,
      status: 'approved',
      outcome: { kind: 'failed_before_execution' },
      recovery: { status: 'available' },
    };
    const { rerenderTranscript } = renderTranscript(
      [{ id: 'outcome', kind: 'approval', approval }],
      { onRepairUnsafeAction: onRepair, onReviewUnsafeAction: vi.fn() },
    );

    const outcome = screen.getByRole('group', { name: 'Change didn’t run' });
    expect(outcome).toHaveTextContent('No project content was changed.');
    expect(outcome).not.toHaveTextContent('Approved.');
    await user.click(screen.getByRole('button', { name: 'Fix and review' }));
    expect(onRepair).toHaveBeenCalledWith(approval);
    expect(
      screen.getByRole('button', { name: 'Review details' }),
    ).toBeVisible();

    rerenderTranscript([{ id: 'outcome', kind: 'approval', approval }], {
      autoApproveEnabled: true,
    });
    expect(
      screen.getByRole('button', {
        name: /Fix with Auto.*Auto is on.*may run automatically/,
      }),
    ).toBeVisible();

    rerenderTranscript([
      {
        id: 'outcome',
        kind: 'approval',
        approval: { ...approval, recovery: { status: 'starting' } },
      },
    ]);
    expect(
      screen.getByRole('button', { name: 'Preparing fix…' }),
    ).toBeDisabled();
  });

  it('keeps the outcome short and shows what stopped the change on its own', () => {
    renderTranscript([
      {
        id: 'outcome',
        kind: 'approval',
        approval: {
          ...pendingApproval,
          status: 'approved',
          outcome: { kind: 'failed_after_execution' },
          error: 'The connection dropped while the change ran.',
        },
      },
    ]);

    const outcome = screen.getByRole('group', {
      name: 'Change may be incomplete',
    });
    // Two callouts: the outcome with its title and description, then the
    // error alone
    const [outcomeCallout, errorCallout] =
      within(outcome).getAllByRole('alert');
    expect(outcomeCallout).toHaveTextContent(
      'Change may be incomplete' +
        'Some project content may have changed. Check DatoCMS before trying again.',
    );
    expect(outcomeCallout).not.toHaveTextContent('The connection dropped');
    expect(errorCallout).toHaveTextContent(
      'The connection dropped while the change ran.',
    );
  });

  it('marks an outcome that needs checking as a risk', () => {
    renderTranscript([
      {
        id: 'outcome',
        kind: 'approval',
        approval: {
          ...pendingApproval,
          status: 'approved',
          outcome: { kind: 'unknown' },
        },
      },
    ]);

    const outcome = screen.getByRole('group', {
      name: 'Outcome needs checking',
    });
    expect(within(outcome).getByRole('alert')).toHaveTextContent(
      'Outcome needs checking' +
        'The change may have run. Check DatoCMS before trying again.',
    );
  });

  it('keeps a partial response with its error and offers the recovery actions', async () => {
    let finishRetry: (() => void) | undefined;
    const onRetry = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRetry = resolve;
        }),
    );
    renderTranscript(
      [
        {
          id: 'failed',
          kind: 'message',
          role: 'assistant',
          content: 'I found two records.',
          error: 'The request stopped.',
          failure: { id: 'failure', retryable: true },
        },
      ],
      {
        onCopyFailureDiagnostics: vi.fn(async () => undefined),
        onRetryFailedTurn: onRetry,
      },
    );

    expect(screen.getByText('I found two records.')).toBeVisible();
    expect(
      screen.getByText('The request stopped.').closest('.Callout'),
    ).toHaveAttribute('role', 'alert');

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(onRetry).toHaveBeenCalledWith('failure');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Copy diagnostics' }),
    ).toHaveAttribute('aria-disabled', 'true');

    await act(async () => {
      finishRetry?.();
    });

    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Copy diagnostics' }),
    ).not.toHaveAttribute('aria-disabled');
  });

  it('says Copied in the button for 2 seconds and keeps a failed copy there until the next attempt', async () => {
    vi.useFakeTimers();
    const onCopy = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Clipboard unavailable'));
    renderTranscript(
      [
        {
          id: 'failed',
          kind: 'message',
          role: 'assistant',
          content: '',
          error: 'The request stopped.',
          failure: { id: 'failure', retryable: false },
        },
      ],
      { onCopyFailureDiagnostics: onCopy },
    );

    expect(
      screen.queryByRole('button', { name: 'Try again' }),
    ).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }));
    });

    expect(screen.getByRole('button', { name: 'Copied' })).toBeVisible();
    expect(screen.getByText('Diagnostics copied')).toHaveRole('status');

    act(() => {
      vi.advanceTimersByTime(1_999);
    });
    expect(screen.getByRole('button', { name: 'Copied' })).toBeVisible();
    act(() => {
      vi.advanceTimersByTime(1);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }));
    });

    // The failure is the label of the button, and it is announced as an alert
    expect(
      screen.getByRole('button', { name: 'Couldn’t copy diagnostics' }),
    ).toBeVisible();
    expect(
      screen.getByText('Couldn’t copy diagnostics', {
        selector: '[role="alert"]',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('');
    // Only the button and its announcement say it, no message under them
    expect(screen.getAllByText('Couldn’t copy diagnostics')).toHaveLength(2);

    // A failure stays until the next attempt
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(
      screen.getByRole('button', { name: 'Couldn’t copy diagnostics' }),
    ).toBeVisible();
    expect(
      screen.getByText('Couldn’t copy diagnostics', {
        selector: '[role="alert"]',
      }),
    ).toBeInTheDocument();
  });

  it('hides the actions that have no handler instead of disabling them', () => {
    renderTranscript([
      {
        id: 'failed',
        kind: 'message',
        role: 'assistant',
        content: '',
        error: 'The request stopped.',
        failure: { id: 'failure', retryable: true },
      },
      { id: 'approval', kind: 'approval', approval: pendingApproval },
    ]);

    expect(screen.getByText('The request stopped.')).toBeVisible();
    for (const name of [
      'Try again',
      'Copy diagnostics',
      'Deny',
      'Approve',
      'Review details',
    ]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('follows new content only while the reader is near the bottom', () => {
    const first: AgentTranscriptEntry = {
      id: 'message',
      kind: 'message',
      role: 'assistant',
      content: 'First',
    };
    const { rerenderTranscript } = renderTranscript([first]);

    const log = screen.getByRole('log');
    Object.defineProperties(log, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, value: 100, writable: true },
    });
    fireEvent.scroll(log);
    scrollIntoView.mockClear();

    rerenderTranscript([{ ...first, content: 'First, longer' }]);
    expect(scrollIntoView).not.toHaveBeenCalled();

    rerenderTranscript([
      { ...first, content: 'First, longer' },
      { id: 'user', kind: 'message', role: 'user', content: 'Next' },
    ]);
    expect(scrollIntoView).toHaveBeenCalledOnce();

    log.scrollTop = 550;
    fireEvent.scroll(log);
    rerenderTranscript([
      { ...first, content: 'First, longer' },
      { id: 'user', kind: 'message', role: 'user', content: 'Next' },
      { id: 'reply', kind: 'message', role: 'assistant', content: 'Reply' },
    ]);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });
});
