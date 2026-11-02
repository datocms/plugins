import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import type { RenderInspectorCtx, RenderModalCtx } from 'datocms-plugin-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeCtx } from '../test/canvas';
import AgentUnavailableFrame from './AgentUnavailableFrame';
import ApprovalDetailsModal from './ApprovalDetailsModal';
import FileDetailsModal from './FileDetailsModal';
import LoadingFrame from './LoadingFrame';
import OAuthCallbackPage from './OAuthCallbackPage';

const generateChangeSummary = vi.hoisted(() => vi.fn());

vi.mock('../lib/changeSummary', () => ({
  generateChangeSummary,
  MAX_CHANGE_SUMMARY_SOURCE_CHARACTERS: 100_000,
}));

beforeEach(() => {
  generateChangeSummary.mockReset();
  generateChangeSummary.mockReturnValue(new Promise(() => undefined));
});

afterEach(cleanup);

function approvalModalCtx({
  canDecide = false,
  colorScheme = 'light',
  decision,
  details = [{ label: 'Environment', value: 'Primary' }],
  error,
  outcome,
  resolve = vi.fn().mockResolvedValue(undefined),
  script = 'const title: string = "Hello";',
}: {
  canDecide?: boolean;
  colorScheme?: 'light' | 'dark';
  decision?: 'approved' | 'rejected';
  details?: Array<{ label: string; value: string }>;
  error?: string;
  outcome?: {
    kind: 'failed_before_execution' | 'failed_after_execution' | 'unknown';
    diagnostic?: string;
  };
  resolve?: ReturnType<typeof vi.fn>;
  script?: string | null;
} = {}): RenderModalCtx {
  return fakeCtx<RenderModalCtx>({
    mode: 'renderModal',
    colorScheme,
    parameters: {
      canDecide,
      details,
      ...(decision ? { decision } : {}),
      ...(error ? { error } : {}),
      ...(outcome ? { outcome } : {}),
      ...(script === null
        ? {}
        : { script: { language: 'typescript', source: script } }),
    },
    plugin: {
      attributes: {
        parameters: {
          provider: 'openai',
          openAiApiKey: 'test-key',
          model: 'gpt-test',
        },
      },
    },
    resolve,
  });
}

function fileModalCtx(parameters: Record<string, unknown>): RenderModalCtx {
  return fakeCtx<RenderModalCtx>({ mode: 'renderModal', parameters });
}

// The code is behind its disclosure: closed, it is in the page but hidden
function codeRegion() {
  return screen.getByRole('region', {
    name: 'Code of the change',
    hidden: true,
  });
}

function firstStringColor(container: HTMLElement): string {
  const string = container.querySelector<HTMLElement>(
    'pre[data-highlighted="true"] .token.string',
  );
  return string?.style.color ?? '';
}

describe('auxiliary surfaces', () => {
  it('announces the lazy-loading state', () => {
    render(<LoadingFrame ctx={fakeCtx<RenderInspectorCtx>()} />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading Dato Agent');
  });

  it('announces the unavailable message in the narrow chat column', () => {
    const title = 'Dato Agent isn’t available for your role';
    // The chat column of the inspector is narrow
    render(<AgentUnavailableFrame ctx={fakeCtx<RenderInspectorCtx>()} />);
    expect(screen.getByText(title).closest('.blank-slate')).toHaveClass(
      'blank-slate--small',
    );
    // The frame fails closed: the denial is announced
    expect(screen.getByRole('status')).toHaveTextContent(title);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Ask a project admin to add your role in the plugin settings.',
    );
  });

  it('renders syntax-highlighted TypeScript immediately while the summary loads', () => {
    const source = [
      'const title: string = "Hello";',
      'await client.items.update("123", { title });',
    ].join('\n');
    render(
      <ApprovalDetailsModal
        ctx={approvalModalCtx({ canDecide: true, script: source })}
      />,
    );

    expect(screen.getByText('Environment')).toBeVisible();
    expect(screen.getByText('Primary')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Summary' })).toBeVisible();
    expect(screen.getByText('Summarizing this change')).toBeVisible();
    expect(
      screen.getByText('Summarizing this change').closest('[aria-busy]'),
    ).toHaveAttribute('aria-busy', 'true');
    // The summary is what an editor reads: the code waits behind a disclosure
    const showCode = screen.getByRole('button', { name: 'Show the code' });
    expect(showCode).toHaveAttribute('aria-expanded', 'false');
    expect(codeRegion()).not.toBeVisible();
    fireEvent.click(showCode);
    expect(showCode).toHaveAttribute('aria-expanded', 'true');
    expect(codeRegion()).toBeVisible();
    const code = codeRegion().querySelector('pre code');
    expect(code?.textContent).toBe(source);
    expect(code?.closest('pre')).toHaveAttribute('data-highlighted', 'true');
    expect(code?.querySelectorAll('[data-line-number]')).toHaveLength(2);
    expect(code?.querySelector('.token.keyword')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    expect(generateChangeSummary).toHaveBeenCalledTimes(1);
    expect(generateChangeSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          provider: 'openai',
          openAiApiKey: 'test-key',
          model: 'gpt-test',
        }),
        script: source,
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('uses the native light and dark Prism themes for the token colors only', () => {
    const source = 'const value: string = "DatoCMS";';
    const light = render(
      <ApprovalDetailsModal
        ctx={approvalModalCtx({ colorScheme: 'light', script: source })}
      />,
    );
    const lightStringColor = firstStringColor(light.container);
    const lightCode = light.container.querySelector<HTMLElement>(
      'pre[data-highlighted="true"]',
    );
    // The snippet draws the surface and the plain ink, not the theme
    expect(lightCode?.style.color).toBe('');
    expect(lightCode?.style.backgroundColor).toBe('');
    light.unmount();

    const dark = render(
      <ApprovalDetailsModal
        ctx={approvalModalCtx({ colorScheme: 'dark', script: source })}
      />,
    );
    const darkStringColor = firstStringColor(dark.container);

    expect(lightStringColor).not.toBe('');
    expect(darkStringColor).not.toBe('');
    expect(darkStringColor).not.toBe(lightStringColor);
  });

  it('preserves blank lines and a trailing newline exactly', () => {
    const source = 'const value = 1;\n\n';
    render(<ApprovalDetailsModal ctx={approvalModalCtx({ script: source })} />);

    const code = codeRegion().querySelector('pre code');
    expect(code?.textContent).toBe(source);
    expect(code?.querySelectorAll('[data-line-number]')).toHaveLength(3);
  });

  it('keeps very large scripts complete without tokenizing or summarizing them', async () => {
    const source = 'x'.repeat(100_001);
    render(<ApprovalDetailsModal ctx={approvalModalCtx({ script: source })} />);

    // Without a summary, the code is the content: it starts open
    expect(codeRegion()).toBeVisible();
    const code = codeRegion().querySelector('pre code');
    expect(code?.textContent).toBe(source);
    expect(code?.closest('pre')).toHaveAttribute('data-highlighted', 'false');
    expect(code?.querySelector('.token')).not.toBeInTheDocument();
    // A short title says the problem, the text the next step
    const tooLarge = await screen.findByText(
      'This change is too large to summarize',
    );
    expect(tooLarge).toBeVisible();
    expect(tooLarge.closest('.Callout')).toHaveTextContent(
      'Check the code below.',
    );
    expect(
      screen.queryByRole('button', { name: 'Try again' }),
    ).not.toBeInTheDocument();
    expect(generateChangeSummary).not.toHaveBeenCalled();
  });

  it('renders generated source as inert text', () => {
    const source = '<img src=x onerror="alert(1)">';
    const { container } = render(
      <ApprovalDetailsModal ctx={approvalModalCtx({ script: source })} />,
    );

    expect(codeRegion().querySelector('pre code')?.textContent).toBe(source);
    expect(container.querySelector('img')).not.toBeInTheDocument();
  });

  it('renders generated summaries as inert text', async () => {
    const summary = '<img src=x onerror="alert(1)"><script>bad()</script>';
    generateChangeSummary.mockResolvedValue(summary);
    const { container } = render(
      <ApprovalDetailsModal ctx={approvalModalCtx()} />,
    );

    expect(await screen.findByText(summary)).toBeVisible();
    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(container.querySelector('script')).not.toBeInTheDocument();
  });

  it('shows a compact escaped run outcome and technical diagnostic', async () => {
    generateChangeSummary.mockResolvedValue('Attempts to update one record.');
    const diagnostic = '<img src=x onerror="alert(1)">\nType mismatch';
    const { container } = render(
      <ApprovalDetailsModal
        ctx={approvalModalCtx({
          outcome: {
            kind: 'failed_before_execution',
            diagnostic,
          },
        })}
      />,
    );

    const notice = screen.getByText('Change didn’t run').closest('.Callout');
    expect(notice).toHaveAttribute('role', 'alert');
    expect(notice).toHaveTextContent('Nothing was changed.');
    // The outcome is the one warning: no second caveat after the decision
    expect(
      screen.queryByText(/This summary is written automatically/),
    ).not.toBeInTheDocument();

    const toggle = screen.getByRole('button', {
      name: 'Show the technical error',
    });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // The raw error comes last, after the code
    expect(
      screen
        .getByRole('button', { name: 'Show the code' })
        .compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.queryByRole('region', { name: 'Technical error' }),
    ).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByRole('region', { name: 'Technical error' }).textContent,
    ).toBe(diagnostic);
    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(
      await screen.findByText('Attempts to update one record.'),
    ).toBeVisible();
    expect(
      screen.queryByText(/This summary is written automatically/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Fix/i }),
    ).not.toBeInTheDocument();
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
  ])('renders the %s outcome without approval actions', (kind, title, copy) => {
    render(
      <ApprovalDetailsModal ctx={approvalModalCtx({ outcome: { kind } })} />,
    );

    expect(screen.getByText(title)).toBeVisible();
    expect(screen.getByText(copy)).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Show the technical error' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Approve' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Deny' }),
    ).not.toBeInTheDocument();
  });

  it('says why a change failed, in the words of its card', () => {
    render(
      <ApprovalDetailsModal
        ctx={approvalModalCtx({
          error: 'The Italian title is required.',
          outcome: {
            kind: 'failed_after_execution',
            diagnostic: 'ApiError: 422 INVALID_FIELD',
          },
        })}
      />,
    );

    expect(
      screen.getByText('Change may be incomplete').closest('.Callout'),
    ).toHaveTextContent(
      'Some content may have changed. Ask the agent to check, or look at the content yourself. The Italian title is required.',
    );
    // The raw error stays behind its disclosure
    expect(
      screen.getByRole('button', { name: 'Show the technical error' }),
    ).toHaveAttribute('aria-expanded', 'false');
  });

  it('omits code and summary UI when no valid script was provided', () => {
    render(
      <ApprovalDetailsModal
        ctx={approvalModalCtx({ canDecide: true, script: null })}
      />,
    );

    expect(generateChangeSummary).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: 'Show the code' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('region', {
        name: 'Code of the change',
        hidden: true,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Summary' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('Summarizing this change'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Primary')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled();
  });

  it('shows one successful summary without making a second request on rerender', async () => {
    generateChangeSummary.mockResolvedValue(
      'Updates the title of one existing record.',
    );
    const ctx = approvalModalCtx({ canDecide: true });
    const { rerender } = render(<ApprovalDetailsModal ctx={ctx} />);

    expect(
      await screen.findByText('Updates the title of one existing record.'),
    ).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Summary' })).toBeVisible();
    // One neutral sentence: a standing caveat, not a warning about this change
    const caveat = screen
      .getByText(/This summary is written automatically/)
      .closest('.Callout');
    expect(caveat).toHaveTextContent(
      'This summary is written automatically and can be wrong: if anything looks unexpected, deny the change.',
    );
    expect(caveat).not.toHaveAttribute('role', 'alert');
    // The live region announces the summary, not the caveat
    expect(
      screen
        .getByText('Updates the title of one existing record.')
        .closest('[aria-live="polite"]'),
    ).not.toBeNull();
    expect(caveat?.closest('[aria-live]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled();

    rerender(<ApprovalDetailsModal ctx={ctx} />);
    expect(
      screen.getByText('Updates the title of one existing record.'),
    ).toBeVisible();
    expect(generateChangeSummary).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['approved' as const, 'Approved.'],
    ['rejected' as const, 'Denied. No action was taken.'],
  ])(
    'tells the decision of a %s change, without the caveat',
    async (decision, text) => {
      generateChangeSummary.mockResolvedValue('Publishes one record.');
      render(<ApprovalDetailsModal ctx={approvalModalCtx({ decision })} />);

      expect(screen.getByText(text)).toBeVisible();
      expect(await screen.findByText('Publishes one record.')).toBeVisible();
      expect(
        screen.queryByText(/This summary is written automatically/),
      ).not.toBeInTheDocument();
    },
  );

  it('offers a compact retry when summary generation fails', async () => {
    generateChangeSummary
      .mockRejectedValueOnce(new Error('Provider unavailable'))
      .mockResolvedValueOnce('Creates one draft article.');
    render(
      <ApprovalDetailsModal ctx={approvalModalCtx({ canDecide: true })} />,
    );

    // A failed load is a blank slate with an error, inside the live region
    const failure = await screen.findByText('Couldn’t summarize this change');
    expect(failure).toBeVisible();
    expect(failure.closest('.blank-slate')).not.toBeNull();
    expect(failure.closest('[aria-live="polite"]')).not.toBeNull();
    // The editor who can't read the code can still deny
    expect(
      screen.getByText(
        'Check the code below, or deny the change if you’re not sure what it does.',
      ),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Creates one draft article.')).toBeVisible();
    expect(generateChangeSummary).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['Approve', 'approve'],
    ['Deny', 'deny'],
  ] as const)(
    'returns %s decisions from a pending approval modal',
    (label, decision) => {
      const resolve = vi.fn().mockResolvedValue(undefined);
      const ctx = approvalModalCtx({ canDecide: true, resolve });

      render(<ApprovalDetailsModal ctx={ctx} />);
      const signal = generateChangeSummary.mock.calls[0]?.[0]
        .signal as AbortSignal;
      fireEvent.click(screen.getByRole('button', { name: label }));

      expect(resolve).toHaveBeenCalledWith(decision);
      expect(signal.aborted).toBe(true);
    },
  );

  it('shows progress on the decision being saved and locks the other one', () => {
    const resolve = vi.fn(() => new Promise<void>(() => undefined));
    render(
      <ApprovalDetailsModal
        ctx={approvalModalCtx({ canDecide: true, resolve })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    const approve = screen.getByRole('button', { name: 'Approve' });
    expect(approve).toHaveAttribute('aria-busy', 'true');
    expect(approve).toBeDisabled();
    const deny = screen.getByRole('button', { name: 'Deny' });
    expect(deny).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(deny);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('aborts summary generation when the modal closes', () => {
    const { unmount } = render(
      <ApprovalDetailsModal ctx={approvalModalCtx()} />,
    );
    const signal = generateChangeSummary.mock.calls[0]?.[0]
      .signal as AbortSignal;

    unmount();

    expect(signal.aborted).toBe(true);
  });

  it('keeps approval actions available after the decision cannot be saved', async () => {
    const resolve = vi.fn().mockRejectedValue(new Error('Frame closed'));
    const ctx = approvalModalCtx({ canDecide: true, resolve });

    render(<ApprovalDetailsModal ctx={ctx} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    const error = await screen.findByText('Couldn’t save this decision');
    expect(error.closest('.Callout')).toHaveAttribute('role', 'alert');
    expect(error.closest('.Callout')).toHaveTextContent('Try again.');
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Approve' })).not.toHaveAttribute(
      'aria-disabled',
    );
    expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Deny' })).not.toHaveAttribute(
      'aria-disabled',
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Try again' }),
    ).not.toHaveAttribute('aria-disabled');
  });

  it('does not allow summary retries while a decision is being saved', async () => {
    let settleDecision: (() => void) | undefined;
    const resolve = vi.fn(
      () =>
        new Promise<void>((resolveDecision) => {
          settleDecision = resolveDecision;
        }),
    );

    render(
      <ApprovalDetailsModal
        ctx={approvalModalCtx({ canDecide: true, resolve })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    const retry = screen.getByRole('button', { name: 'Try again' });
    expect(retry).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(retry);
    expect(generateChangeSummary).toHaveBeenCalledTimes(1);

    settleDecision?.();
  });

  it('distinguishes a session-local file from a DatoCMS asset', () => {
    const parameters = {
      filename: 'brief.pdf',
      mimeType: 'application/pdf',
      size: 2048,
      lastModified: 1_786_000_000_000,
      bytesAvailable: true,
    };

    const { rerender } = render(
      <FileDetailsModal ctx={fileModalCtx(parameters)} />,
    );

    expect(screen.getByText('brief.pdf')).toBeVisible();
    // The filename tells the kind: no MIME type
    expect(screen.queryByText('application/pdf')).not.toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeVisible();
    const notice = screen
      .getByText(
        'The agent can read this file while this page is open, but it isn’t saved in the Media Area.',
      )
      .closest('.Callout');
    // Nothing is wrong yet: a neutral note
    expect(notice).not.toHaveAttribute('role', 'alert');
    const lastModified = screen
      .getByText('Last modified')
      .closest('.InfoList__row');
    expect(lastModified?.querySelector('time')?.getAttribute('datetime')).toBe(
      new Date(1_786_000_000_000).toISOString(),
    );

    rerender(
      <FileDetailsModal
        ctx={fileModalCtx({ ...parameters, bytesAvailable: false })}
      />,
    );
    const expired = screen
      .getByText(
        'This file is no longer available: attach it again if the agent needs it.',
      )
      .closest('.Callout');
    expect(expired).toBeVisible();
    expect(expired).toHaveAttribute('role', 'alert');
  });

  it('falls back to defaults for missing file details', () => {
    render(<FileDetailsModal ctx={fileModalCtx({ lastModified: 0 })} />);

    const rows = Array.from(document.querySelectorAll('.InfoList__row')).map(
      (row) => row.textContent,
    );
    // An unknown size or date tells nothing: their rows stay out
    expect(rows).toEqual(['FilenameUntitled file']);
    expect(
      within(document.body).getByText(
        'This file is no longer available: attach it again if the agent needs it.',
      ),
    ).toBeVisible();
  });

  it('exposes concise success and error callback statuses', () => {
    const { rerender } = render(
      <OAuthCallbackPage message="Return to the agent." />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Finishing sign-in');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Return to the agent.',
    );

    rerender(<OAuthCallbackPage error message="Authorization expired." />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Connection could not be completed',
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Authorization expired.',
    );
  });
});
