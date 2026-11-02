import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderInCanvas } from '../test/canvas';
import type { CheckResult, LinkGroup } from '../types';
import { LinkDetail, type LinkDetailProps } from './InfoSidebar';

const LINK_URL = 'https://shared.example/pricing';

function group(
  result: Partial<CheckResult> = {},
  options: {
    fragment?: boolean;
    stale?: boolean;
    status?: 'queued' | 'skipped';
  } = {},
): LinkGroup {
  return {
    key: LINK_URL,
    prepared: {
      key: LINK_URL,
      url: LINK_URL,
      hostname: 'shared.example',
      status: options.status ?? 'queued',
      message: '',
    },
    result: {
      key: LINK_URL,
      url: LINK_URL,
      status: 'broken',
      message: "The site says this page doesn't exist.",
      httpStatus: 404,
      checkedAt: '2026-09-23T12:01:00Z',
      ...result,
    },
    stale: options.stale ?? false,
    occurrences: [
      {
        id: 'place-1',
        url: options.fragment ? `${LINK_URL}#plans` : LINK_URL,
        recordId: 'record-1',
        recordTitle: 'Pricing',
        modelId: 'page',
        modelName: 'Page',
        fieldPath: 'body.en',
        fieldLabel: 'Body',
        locale: 'en',
        blockPath: [],
      },
    ],
  };
}

function show(props: Partial<LinkDetailProps> = {}) {
  const all: LinkDetailProps = {
    group: group(),
    scanning: false,
    rechecking: false,
    rechecked: false,
    changedRecordIds: new Set(),
    showLocale: true,
    uiLocale: 'en',
    linkPanel: { open: true, onToggle: vi.fn() },
    recordsPanel: { open: true, onToggle: vi.fn() },
    onRecheck: vi.fn(),
    onOpenRecord: vi.fn(),
    ...props,
  };
  const view = renderInCanvas(<LinkDetail {...all} />);
  const rerender = (next: Partial<LinkDetailProps>) =>
    view.rerender(<LinkDetail {...all} {...next} />);
  return { ...all, rerender };
}

function detail() {
  return within(screen.getByRole('complementary', { name: 'Link' }));
}

describe('LinkDetail', () => {
  it('shows the open link, its result and the records that use it', async () => {
    const user = userEvent.setup();
    const { onOpenRecord } = show();
    expect(
      detail().getByRole('heading', { level: 2, name: 'Link' }),
    ).toBeInTheDocument();
    // On top: its path, then its site.
    expect(detail().getByText('/pricing')).toBeInTheDocument();
    expect(detail().getByText('shared.example')).toBeInTheDocument();
    expect(
      detail().getByRole('link', { name: `${LINK_URL} (opens in a new tab)` }),
    ).toHaveAttribute('target', '_blank');
    expect(detail().getByText('Broken')).toBeInTheDocument();
    // A broken link says why in plain words; the code has its own row.
    expect(
      detail().getByText("The site says this page doesn't exist."),
    ).toBeInTheDocument();
    expect(detail().getByText('404')).toBeInTheDocument();
    const checked = detail().getByText(/23\/09\/2026/);
    expect(checked.tagName).toBe('TIME');
    expect(checked).toHaveAttribute('datetime', '2026-09-23T12:01:00.000Z');

    await user.click(
      detail().getByRole('button', {
        name: /^Page\s*Pricing\s*,\s*open record$/,
      }),
    );
    expect(onOpenRecord).toHaveBeenCalledWith('record-1');
  });

  it('explains the results whose word needs it and fragments, and leaves a change to the records', () => {
    show({
      group: group(
        {
          status: 'unverified',
          message: 'The site refused automated checks.',
          httpStatus: undefined,
          checkedAt: undefined,
        },
        { fragment: true, stale: true },
      ),
    });
    expect(detail().getByText('Unverified')).toBeInTheDocument();
    expect(
      detail().getByText('The site refused automated checks.'),
    ).toBeInTheDocument();
    expect(
      detail().getByText(/Some records link to a #fragment of this page/),
    ).toBeInTheDocument();
    // The summary of the report and the pill of a changed record say it.
    expect(detail().queryByRole('note')).not.toBeInTheDocument();
    expect(detail().queryByText('HTTP status')).not.toBeInTheDocument();
    expect(detail().queryByText('Checked')).not.toBeInTheDocument();
  });

  it('rechecks a checkable link unless links are being checked', async () => {
    const user = userEvent.setup();
    const { onRecheck, rerender } = show();
    await user.click(detail().getByRole('button', { name: 'Recheck link' }));
    expect(onRecheck).toHaveBeenCalledWith(group());

    rerender({ scanning: true });
    const blocked = detail().getByRole('button', { name: 'Recheck link' });
    expect(blocked).toHaveAttribute('aria-disabled', 'true');
    await user.hover(blocked);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      "You can't recheck a link while links are being checked.",
    );
    await user.click(blocked);
    expect(onRecheck).toHaveBeenCalledTimes(1);

    // Another URL is being rechecked.
    rerender({ rechecking: true });
    expect(
      detail().getByRole('button', { name: 'Recheck link' }),
    ).toHaveAttribute('aria-disabled', 'true');

    // This URL is being rechecked: the button is busy.
    rerender({ rechecking: true, rechecked: true });
    const busy = detail().getByRole('button', { name: 'Recheck link' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy).toBeDisabled();

    rerender({ group: group({ status: 'skipped' }, { status: 'skipped' }) });
    expect(
      detail().queryByRole('button', { name: 'Recheck link' }),
    ).not.toBeInTheDocument();
  });

  it('leaves the open state of its sections to the report', async () => {
    const user = userEvent.setup();
    const linkPanel = { open: false, onToggle: vi.fn() };
    show({ linkPanel });
    expect(detail().queryByText('Broken')).not.toBeInTheDocument();
    expect(
      detail().getByRole('button', {
        name: /^Page\s*Pricing\s*,\s*open record$/,
      }),
    ).toBeInTheDocument();
    await user.click(detail().getByRole('button', { name: 'Result' }));
    expect(linkPanel.onToggle).toHaveBeenCalledWith(true);
  });
});
