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
      message: 'HTTP 404',
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
  return within(screen.getByRole('complementary', { name: 'URL' }));
}

describe('LinkDetail', () => {
  it('shows the open URL, its result and the records that use it', async () => {
    const user = userEvent.setup();
    const { onOpenRecord } = show();
    expect(
      detail().getByRole('heading', { level: 2, name: 'URL' }),
    ).toBeInTheDocument();
    expect(detail().getByText('shared.example')).toBeInTheDocument();
    expect(
      detail().getByRole('link', { name: `${LINK_URL} (opens in a new tab)` }),
    ).toHaveAttribute('target', '_blank');
    expect(detail().getByText('Broken')).toBeInTheDocument();
    expect(detail().getByText('404')).toBeInTheDocument();
    // The status word and the HTTP status row already say it.
    expect(detail().queryByText('HTTP 404')).not.toBeInTheDocument();
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

  it('explains the results whose word needs it, fragments and stale URLs', () => {
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
    const stale = detail().getByRole('note');
    expect(stale).toHaveTextContent(
      /^Content changed after the scanA record using this URL changed after the scan/,
    );
    // The note sits in the "Link" section, above its facts: the panel holds
    // only sections.
    expect(stale.closest('.SidebarPanel')).toHaveTextContent(/^Link/);
    expect(detail().queryByText('HTTP status')).not.toBeInTheDocument();
    expect(detail().queryByText('Checked')).not.toBeInTheDocument();
  });

  it('rechecks a checkable URL unless links are being checked', async () => {
    const user = userEvent.setup();
    const { onRecheck, rerender } = show();
    await user.click(detail().getByRole('button', { name: 'Recheck URL' }));
    expect(onRecheck).toHaveBeenCalledWith(group());

    rerender({ scanning: true });
    const blocked = detail().getByRole('button', { name: 'Recheck URL' });
    expect(blocked).toHaveAttribute('aria-disabled', 'true');
    await user.hover(blocked);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      "You can't recheck a URL while links are being checked.",
    );
    await user.click(blocked);
    expect(onRecheck).toHaveBeenCalledTimes(1);

    // Another URL is being rechecked.
    rerender({ rechecking: true });
    expect(
      detail().getByRole('button', { name: 'Recheck URL' }),
    ).toHaveAttribute('aria-disabled', 'true');

    // This URL is being rechecked: the button is busy.
    rerender({ rechecking: true, rechecked: true });
    const busy = detail().getByRole('button', { name: 'Recheck URL' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy).toBeDisabled();

    rerender({ group: group({ status: 'skipped' }, { status: 'skipped' }) });
    expect(
      detail().queryByRole('button', { name: 'Recheck URL' }),
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
    await user.click(detail().getByRole('button', { name: 'Link' }));
    expect(linkPanel.onToggle).toHaveBeenCalledWith(true);
  });
});
