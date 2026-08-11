import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import type { RenderInspectorCtx, RenderModalCtx } from 'datocms-plugin-sdk';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ApprovalDetailsModal from './ApprovalDetailsModal';
import FileDetailsModal from './FileDetailsModal';
import LoadingFrame from './LoadingFrame';
import OAuthCallbackPage from './OAuthCallbackPage';

const generateChangeSummary = vi.hoisted(() => vi.fn());

vi.mock('../lib/changeSummary', () => ({
  generateChangeSummary,
  MAX_CHANGE_SUMMARY_SOURCE_CHARACTERS: 100_000,
}));

vi.mock('datocms-react-ui', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button disabled={disabled} onClick={onClick} type="button">
      {children}
    </button>
  ),
  Canvas: ({ children }: { children: ReactNode }) => <>{children}</>,
  Spinner: () => <div data-testid="spinner" />,
}));

beforeEach(() => {
  generateChangeSummary.mockReset();
  generateChangeSummary.mockReturnValue(new Promise(() => undefined));
});

afterEach(cleanup);

function approvalModalCtx({
  canDecide = false,
  colorScheme = 'light',
  details = [{ label: 'Environment', value: 'Primary' }],
  outcome,
  resolve = vi.fn().mockResolvedValue(undefined),
  script = 'const title: string = "Hello";',
}: {
  canDecide?: boolean;
  colorScheme?: 'light' | 'dark';
  details?: Array<{ label: string; value: string }>;
  outcome?: {
    kind: 'failed_before_execution' | 'failed_after_execution' | 'unknown';
    diagnostic?: string;
  };
  resolve?: ReturnType<typeof vi.fn>;
  script?: string | null;
} = {}): RenderModalCtx {
  return {
    colorScheme,
    parameters: {
      canDecide,
      details,
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
  } as unknown as RenderModalCtx;
}

describe('auxiliary surfaces', () => {
  it('announces the lazy-loading state', () => {
    render(<LoadingFrame ctx={{} as RenderInspectorCtx} />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Loading Dato Agent (Beta)…');
    expect(within(status).getByTestId('spinner')).toBeInTheDocument();
  });

  it('renders syntax-highlighted TypeScript immediately while the summary loads', () => {
    const source = [
      'const title: string = "Hello";',
      'await client.items.update("123", { title });',
    ].join('\n');
    const { container } = render(
      <ApprovalDetailsModal
        ctx={approvalModalCtx({ canDecide: true, script: source })}
      />,
    );

    expect(screen.getByText('Environment')).toBeVisible();
    expect(screen.getByText('Primary')).toBeVisible();
    expect(
      screen.getByRole('heading', {
        name: 'Generating a summary of this change',
      }),
    ).toBeVisible();
    expect(
      screen
        .getByRole('heading', {
          name: 'Generating a summary of this change',
        })
        .parentElement?.querySelectorAll('[aria-hidden="true"] span'),
    ).toHaveLength(3);
    const code = container.querySelector('pre code');
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

  it('uses the native light and dark Prism themes', () => {
    const source = 'const value: string = "DatoCMS";';
    const light = render(
      <ApprovalDetailsModal
        ctx={approvalModalCtx({ colorScheme: 'light', script: source })}
      />,
    );
    const lightCodeColor = (
      light.container.querySelector(
        'pre[data-highlighted="true"]',
      ) as HTMLElement
    ).style.color;
    light.unmount();

    const dark = render(
      <ApprovalDetailsModal
        ctx={approvalModalCtx({ colorScheme: 'dark', script: source })}
      />,
    );
    const darkCodeColor = (
      dark.container.querySelector(
        'pre[data-highlighted="true"]',
      ) as HTMLElement
    ).style.color;

    expect(lightCodeColor).not.toBe('');
    expect(darkCodeColor).not.toBe('');
    expect(darkCodeColor).not.toBe(lightCodeColor);
  });

  it('preserves blank lines and a trailing newline exactly', () => {
    const source = 'const value = 1;\n\n';
    const { container } = render(
      <ApprovalDetailsModal ctx={approvalModalCtx({ script: source })} />,
    );

    const code = container.querySelector('pre code');
    expect(code?.textContent).toBe(source);
    expect(code?.querySelectorAll('[data-line-number]')).toHaveLength(3);
  });

  it('keeps very large scripts complete without tokenizing or summarizing them', async () => {
    const source = 'x'.repeat(100_001);
    const { container } = render(
      <ApprovalDetailsModal ctx={approvalModalCtx({ script: source })} />,
    );

    const code = container.querySelector('pre code');
    expect(code?.textContent).toBe(source);
    expect(code?.closest('pre')).toHaveAttribute('data-highlighted', 'false');
    expect(code?.querySelector('.token')).not.toBeInTheDocument();
    expect(
      await screen.findByText(
        'This change is too large to summarize. Review the TypeScript below.',
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Retry' }),
    ).not.toBeInTheDocument();
    expect(generateChangeSummary).not.toHaveBeenCalled();
  });

  it('renders generated source as inert text', () => {
    const source = '<img src=x onerror="alert(1)">';
    const { container } = render(
      <ApprovalDetailsModal ctx={approvalModalCtx({ script: source })} />,
    );

    expect(container.querySelector('pre code')?.textContent).toBe(source);
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

    expect(screen.getByText('Change didn’t run')).toBeVisible();
    expect(screen.getByText('No project content was changed.')).toBeVisible();
    fireEvent.click(screen.getByText('Technical error'));
    expect(container.querySelector('details pre')?.textContent).toBe(
      diagnostic,
    );
    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(
      await screen.findByText(
        'AI-generated summaries can be wrong. Review the TypeScript to verify this summary.',
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /Fix/i }),
    ).not.toBeInTheDocument();
  });

  it.each([
    [
      'failed_after_execution' as const,
      'Change may be incomplete',
      'Some project content may have changed. Check DatoCMS before trying again.',
    ],
    [
      'unknown' as const,
      'Outcome needs checking',
      'The change may have run. Check DatoCMS before trying again.',
    ],
  ])('renders the %s outcome without approval actions', (kind, title, copy) => {
    render(
      <ApprovalDetailsModal ctx={approvalModalCtx({ outcome: { kind } })} />,
    );

    expect(screen.getByText(title)).toBeVisible();
    expect(screen.getByText(copy)).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Approve' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Deny' }),
    ).not.toBeInTheDocument();
  });

  it('omits code and summary UI when no valid script was provided', () => {
    render(
      <ApprovalDetailsModal
        ctx={approvalModalCtx({ canDecide: true, script: null })}
      />,
    );

    expect(generateChangeSummary).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('heading', { name: 'Generated TypeScript' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', {
        name: 'Generating a summary of this change',
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled();
  });

  it('shows one successful summary without making a second request on rerender', async () => {
    generateChangeSummary.mockResolvedValue(
      'Updates the title of one existing record.',
    );
    render(
      <ApprovalDetailsModal ctx={approvalModalCtx({ canDecide: true })} />,
    );

    expect(
      await screen.findByText('Updates the title of one existing record.'),
    ).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Summary' })).toBeVisible();
    expect(
      screen.getByText(
        'AI-generated summaries can be wrong. Review the TypeScript before approving.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled();
    expect(generateChangeSummary).toHaveBeenCalledTimes(1);
  });

  it('offers a compact retry when summary generation fails', async () => {
    generateChangeSummary
      .mockRejectedValueOnce(new Error('Provider unavailable'))
      .mockResolvedValueOnce('Creates one draft article.');
    render(<ApprovalDetailsModal ctx={approvalModalCtx()} />);

    expect(
      await screen.findByText(
        'Couldn’t generate a summary. Review the TypeScript below.',
      ),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

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

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not save this decision. Try again.',
    );
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
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

    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
    expect(generateChangeSummary).toHaveBeenCalledTimes(1);

    settleDecision?.();
  });

  it('distinguishes a session-local file from a DatoCMS asset', () => {
    const availableCtx = {
      parameters: {
        filename: 'brief.pdf',
        mimeType: 'application/pdf',
        size: 2048,
        lastModified: 1_786_000_000_000,
        bytesAvailable: true,
      },
    } as unknown as RenderModalCtx;

    const { rerender } = render(<FileDetailsModal ctx={availableCtx} />);

    expect(screen.getByText('brief.pdf')).toBeVisible();
    expect(screen.getByText('2.0 KB')).toBeVisible();
    expect(
      screen.getByText('This file is not yet a DatoCMS asset.'),
    ).toBeVisible();
    expect(
      screen.getByText(
        'File bytes are available only for this browser session.',
      ),
    ).toBeVisible();

    rerender(
      <FileDetailsModal
        ctx={
          {
            ...availableCtx,
            parameters: { ...availableCtx.parameters, bytesAvailable: false },
          } as RenderModalCtx
        }
      />,
    );
    expect(
      screen.getByText(
        'The file bytes are no longer available; only its metadata remains.',
      ),
    ).toBeVisible();
  });

  it('exposes concise success and error callback statuses', () => {
    const { rerender } = render(
      <OAuthCallbackPage message="Return to the agent." />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('DatoCMS connected');
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
