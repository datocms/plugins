import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import type { RenderInspectorCtx, RenderModalCtx } from 'datocms-plugin-sdk';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ApprovalDetailsModal from './ApprovalDetailsModal';
import FileDetailsModal from './FileDetailsModal';
import LoadingFrame from './LoadingFrame';
import OAuthCallbackPage from './OAuthCallbackPage';

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

afterEach(cleanup);

describe('auxiliary surfaces', () => {
  it('announces the lazy-loading state', () => {
    render(<LoadingFrame ctx={{} as RenderInspectorCtx} />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Loading Dato Agent (Beta)…');
    expect(within(status).getByTestId('spinner')).toBeInTheDocument();
  });

  it('keeps generated code in the approval details modal', () => {
    const ctx = {
      parameters: {
        details: [
          { label: 'Environment', value: 'Primary' },
          {
            label: 'GENERATED TYPESCRIPT',
            value: 'await client.items.update("123", { title: "Hello" });',
          },
        ],
      },
    } as unknown as RenderModalCtx;

    const { container } = render(<ApprovalDetailsModal ctx={ctx} />);

    expect(screen.getByText('Environment')).toBeVisible();
    expect(screen.getByText('Primary')).toBeVisible();
    expect(container.querySelector('pre code')).toHaveTextContent(
      'await client.items.update("123", { title: "Hello" });',
    );
    expect(
      screen.queryByRole('button', { name: 'Approve' }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ['Approve', 'approve'],
    ['Deny', 'deny'],
  ] as const)(
    'returns %s decisions from a pending approval modal',
    (label, decision) => {
      const resolve = vi.fn().mockResolvedValue(undefined);
      const ctx = {
        parameters: {
          canDecide: true,
          details: [{ label: 'Target', value: 'Homepage' }],
        },
        resolve,
      } as unknown as RenderModalCtx;

      render(<ApprovalDetailsModal ctx={ctx} />);
      fireEvent.click(screen.getByRole('button', { name: label }));

      expect(resolve).toHaveBeenCalledWith(decision);
    },
  );

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
