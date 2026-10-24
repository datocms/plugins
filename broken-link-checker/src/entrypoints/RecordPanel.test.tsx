import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RenderItemFormSidebarPanelCtx } from 'datocms-plugin-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred, panelContext, rawRecord } from '../test/fixtures';
import RecordPanel from './RecordPanel';

type FormItem = Awaited<
  ReturnType<RenderItemFormSidebarPanelCtx['formValuesToItem']>
>;

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock
    .mockReset()
    .mockImplementation(async () => new Response(null, { status: 404 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function formItem(url: unknown): FormItem {
  return rawRecord('record-1', url) as unknown as FormItem;
}

function resultFor(url: string): HTMLElement {
  const result = screen.getByText(url).closest('li');
  if (!result) throw new Error(`${url} has no result item`);
  return result;
}

/** The row of a place, named by where it goes: the field, then its locale. */
function placeRow(result: HTMLElement, name: RegExp): HTMLElement {
  return within(result).getByRole('button', { name });
}

/** The panel's one live region, mounted empty and filled when a check settles. */
async function announced(text: string) {
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent(text),
  );
}

const SPINNER = '.Spinner';
const SAVING = "You can't check links while the record is being saved.";
const UNREAD_TITLE = "Some content couldn't be read";

describe('record link-check panel', () => {
  it('checks unsaved content in every locale without a token, save or field write', async () => {
    const user = userEvent.setup();
    const ctx = panelContext({ currentUserAccessToken: undefined });
    render(<RecordPanel ctx={ctx} />);
    // Only the action: no intro, and no locale switch since every locale is checked.
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    await user.click(screen.getByRole('button', { name: 'Check links' }));
    await announced('2 URLs need attention');
    expect(ctx.formValuesToItem).toHaveBeenCalledWith(ctx.formValues, false);
    expect(
      screen.getByText('2 URLs need attention', { ignore: '[role="status"]' }),
    ).toBeInTheDocument();
    const broken = resultFor('https://broken.example/page');
    expect(within(broken).getByText('Broken')).toBeInTheDocument();
    expect(within(broken).getByText(/HTTP 404/)).toBeInTheDocument();
    expect(within(broken).getByText('Website')).toBeInTheDocument();
    expect(within(broken).getByText('English')).toBeInTheDocument();
    // The URL opens in a new tab.
    const link = within(broken).getByRole('link', {
      name: 'https://broken.example/page (opens in a new tab)',
    });
    expect(link).toHaveAttribute('href', 'https://broken.example/page');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    const italian = resultFor('https://italian.example/page');
    expect(within(italian).getByText('Italian')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled();
    expect(ctx.saveCurrentItem).not.toHaveBeenCalled();
    expect(ctx.setFieldValue).not.toHaveBeenCalled();
    expect(ctx.editItem).not.toHaveBeenCalled();
  });

  it("lets the place rows go out into the frame's side padding, never past it", () => {
    render(<RecordPanel ctx={panelContext({ bodyPadding: [0, 12, 10, 8] })} />);
    const panel = screen
      .getByRole('button', { name: 'Check links' })
      .closest<HTMLElement>('[style*="--frame-inset-left"]');
    expect(panel?.style.getPropertyValue('--frame-inset-left')).toBe('8px');
    expect(panel?.style.getPropertyValue('--frame-inset-right')).toBe('12px');
  });

  it('goes to the localized containing field from the whole place row', async () => {
    const user = userEvent.setup();
    const ctx = panelContext();
    render(<RecordPanel ctx={ctx} />);
    await user.click(screen.getByRole('button', { name: 'Check links' }));
    await announced('2 URLs need attention');
    const italian = resultFor('https://italian.example/page');
    await user.click(
      placeRow(italian, /^Website\s*Italian\s*,\s*go to field$/),
    );
    expect(ctx.scrollToField).toHaveBeenCalledWith('url.it', 'it');
    // The row works from the keyboard too.
    placeRow(italian, /^Website.*,\s*go to field$/).focus();
    await user.keyboard('{Enter}');
    expect(ctx.scrollToField).toHaveBeenCalledTimes(2);
    expect(ctx.saveCurrentItem).not.toHaveBeenCalled();
  });

  it("checks only the record's own locales", async () => {
    const user = userEvent.setup();
    const ctx = panelContext({
      formValues: {
        url: {
          en: 'https://broken.example/page',
          it: 'https://italian.example/page',
        },
        internalLocales: ['en'],
      },
    });
    render(<RecordPanel ctx={ctx} />);
    await user.click(screen.getByRole('button', { name: 'Check links' }));
    // The form still holds an Italian value, but the record has no Italian locale.
    await announced('1 URL needs attention');
    expect(
      screen.queryByText('https://italian.example/page'),
    ).not.toBeInTheDocument();
  });

  it('does not pass a removed locale to a navigation method that could add it back', async () => {
    const user = userEvent.setup();
    const ctx = panelContext();
    const view = render(<RecordPanel ctx={ctx} />);
    await user.click(screen.getByRole('button', { name: 'Check links' }));
    await announced('2 URLs need attention');
    // Italian is removed from the record after the check.
    const removed = {
      ...ctx,
      formValues: { ...ctx.formValues, internalLocales: ['en'] },
    } as RenderItemFormSidebarPanelCtx;
    view.rerender(<RecordPanel ctx={removed} />);
    await user.click(
      placeRow(
        resultFor('https://italian.example/page'),
        /^Website.*,\s*go to field$/,
      ),
    );
    expect(ctx.scrollToField).toHaveBeenCalledWith('url.it', undefined);
    expect(ctx.setFieldValue).not.toHaveBeenCalled();
  });

  it('reports content that is still loading instead of a clean check', async () => {
    const user = userEvent.setup();
    const ctx = panelContext();
    vi.mocked(ctx.formValuesToItem).mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<RecordPanel ctx={ctx} />);
    await user.click(screen.getByRole('button', { name: 'Check links' }));
    const loading =
      'The record is still loading. Wait for it to load and check again.';
    const reason = await screen.findByText(loading, { selector: 'p' });
    // Nothing was read, so the reason is the whole message, under its title,
    // and the live region says the reason alone.
    expect(reason.closest('[role="alert"]')).toHaveTextContent(
      `Couldn't read the record${loading}`,
    );
    expect(screen.queryByText(UNREAD_TITLE)).not.toBeInTheDocument();
    await announced(loading);
    expect(screen.getByRole('status').textContent).toBe(loading);
    expect(screen.queryByText(/^No links in/)).not.toBeInTheDocument();
    expect(screen.queryByText(/needs attention/)).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ctx.saveCurrentItem).not.toHaveBeenCalled();
  });

  it('marks existing results stale after form changes without silently checking again', async () => {
    const user = userEvent.setup();
    const ctx = panelContext();
    const { rerender } = render(<RecordPanel ctx={ctx} />);
    await user.click(screen.getByRole('button', { name: 'Check links' }));
    await announced('2 URLs need attention');
    rerender(
      <RecordPanel
        ctx={{
          ...ctx,
          formValues: { ...ctx.formValues, title: 'Changed title' },
        }}
      />,
    );
    expect(
      await screen.findByText(
        'The record changed after this check. Check again to refresh the results.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Results out of date')).toBeInTheDocument();
    expect(screen.getByText('https://broken.example/page')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled();
    expect(ctx.formValuesToItem).toHaveBeenCalledTimes(1);
    // HEAD, then GET, for each of the two URLs.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("keeps results current when only the form's locale changes", async () => {
    const user = userEvent.setup();
    const ctx = panelContext();
    const { rerender } = render(<RecordPanel ctx={ctx} />);
    await user.click(screen.getByRole('button', { name: 'Check links' }));
    await announced('2 URLs need attention');
    // Every locale was checked, so switching the form's locale changes nothing.
    rerender(<RecordPanel ctx={{ ...ctx, locale: 'it' }} />);
    expect(
      screen.queryByText(/The record changed after this check/),
    ).not.toBeInTheDocument();
    expect(screen.getByText('https://broken.example/page')).toBeInTheDocument();
    expect(ctx.formValuesToItem).toHaveBeenCalledTimes(1);
  });

  it('explains why checking is off during a save, then a record that could not be read', async () => {
    const user = userEvent.setup();
    const ctx = panelContext({ isSubmitting: true });
    vi.mocked(ctx.formValuesToItem).mockRejectedValue(
      new Error('Cannot serialize block'),
    );
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(<RecordPanel ctx={ctx} />);
    const check = screen.getByRole('button', { name: 'Check links' });
    expect(check).toHaveAttribute('aria-disabled', 'true');
    // The reason shows on hover (and keyboard focus), and the click does nothing.
    await user.hover(check);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(SAVING);
    await user.click(check);
    expect(ctx.formValuesToItem).not.toHaveBeenCalled();
    await user.unhover(check);
    rerender(<RecordPanel ctx={{ ...ctx, isSubmitting: false }} />);
    expect(
      screen.getByRole('button', { name: 'Check links' }),
    ).not.toHaveAttribute('aria-disabled');
    expect(screen.queryByText(SAVING)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check links' }));
    const failed = "The record couldn't be read. Check again to retry.";
    expect(
      (await screen.findByText(failed, { selector: 'p' })).closest(
        '[role="alert"]',
      ),
    ).toBeInTheDocument();
    // Nothing was read: the live region says the reason alone.
    await announced(failed);
    expect(screen.getByRole('status').textContent).toBe(failed);
    expect(screen.queryByText(UNREAD_TITLE)).not.toBeInTheDocument();
    expect(
      screen.queryByText('Cannot serialize block'),
    ).not.toBeInTheDocument();
    expect(logged).toHaveBeenCalled();
  });

  it('explains fields that could not be loaded, and checks again on request', async () => {
    const user = userEvent.setup();
    const ctx = panelContext();
    vi.mocked(ctx.loadItemTypeFields).mockRejectedValueOnce(
      new Error('API Error!'),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<RecordPanel ctx={ctx} />);
    await user.click(screen.getByRole('button', { name: 'Check links' }));
    expect(
      await screen.findByText(
        "The record's fields couldn't be loaded. Check again to retry.",
        { selector: 'p' },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('API Error!')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Check again' }));
    await announced('2 URLs need attention');
    expect(
      screen.queryByText(/The record's fields couldn't be loaded/),
    ).not.toBeInTheDocument();
  });

  it('shows progress while running and keeps unchecked URLs after a cancel', async () => {
    const user = userEvent.setup();
    const ctx = panelContext();
    const item = deferred<FormItem>();
    vi.mocked(ctx.formValuesToItem).mockReturnValue(item.promise);
    fetchMock.mockImplementation(() => new Promise<Response>(() => undefined));
    render(<RecordPanel ctx={ctx} />);
    await user.click(screen.getByRole('button', { name: 'Check links' }));
    const reading = await screen.findByText('Reading the record…');
    expect(reading.querySelector(SPINNER)).toBeInTheDocument();
    // The action keeps the focus while its label changes.
    const cancel = screen.getByRole('button', { name: 'Cancel check' });
    expect(cancel).toHaveFocus();
    item.resolve(formItem({ en: 'https://broken.example/page' }));
    expect(
      await screen.findByText('Checking URLs (2 left)…'),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await user.click(cancel);
    expect(await screen.findByText('Check canceled')).toBeInTheDocument();
    expect(
      screen.getByText("URLs that weren't checked show as “Not checked”."),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Check canceled').closest('[role="alert"]'),
    ).toBeInTheDocument();
    // The live region says the check was canceled, then the summary.
    await announced('Check canceled. 2 URLs need attention');
    expect(screen.getByRole('status')).toHaveTextContent(
      /^Check canceled\. 2 URLs need attention$/,
    );
    expect(
      within(resultFor('https://broken.example/page')).getByText('Not checked'),
    ).toBeInTheDocument();
    expect(document.querySelector(SPINNER)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled();
  });

  it('shows a host alert when the field cannot be opened', async () => {
    const user = userEvent.setup();
    const ctx = panelContext();
    vi.mocked(ctx.scrollToField).mockRejectedValue(new Error('Field removed'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<RecordPanel ctx={ctx} />);
    await user.click(screen.getByRole('button', { name: 'Check links' }));
    await announced('2 URLs need attention');
    await user.click(
      placeRow(
        resultFor('https://broken.example/page'),
        /^Website.*,\s*go to field$/,
      ),
    );
    await waitFor(() =>
      expect(ctx.alert).toHaveBeenCalledWith("Couldn't open the field."),
    );
    expect(logged).toHaveBeenCalled();
  });

  it('says when the record holds no links', async () => {
    const user = userEvent.setup();
    const ctx = panelContext();
    vi.mocked(ctx.formValuesToItem).mockResolvedValue(
      formItem({ en: '', it: '' }),
    );
    render(<RecordPanel ctx={ctx} />);
    await user.click(screen.getByRole('button', { name: 'Check links' }));
    expect(
      await screen.findByText('No links in this record', {
        ignore: '[role="status"]',
      }),
    ).toBeInTheDocument();
    await announced('No links in this record');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('names no locale on a single-locale site and can show URLs that need no attention', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(
      async () => new Response(null, { status: 200 }),
    );
    const ctx = panelContext({
      site: {
        id: 'site-1',
        attributes: { locales: ['en'], internal_domain: null },
      } as unknown as RenderItemFormSidebarPanelCtx['site'],
    });
    vi.mocked(ctx.formValuesToItem).mockResolvedValue(
      formItem({ en: 'https://ok.example/page#top' }),
    );
    render(<RecordPanel ctx={ctx} />);
    await user.click(screen.getByRole('button', { name: 'Check links' }));
    await announced('Nothing needs attention. 1 URL found');
    expect(
      screen.getByText('Nothing needs attention', {
        ignore: '[role="status"]',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('1 URL found')).toBeInTheDocument();
    expect(
      screen.queryByText('https://ok.example/page#top'),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show 1 URL' }));
    const result = resultFor('https://ok.example/page#top');
    expect(within(result).getByText('Reachable')).toBeInTheDocument();
    expect(placeRow(result, /^Website\s*,\s*go to field$/)).toBeInTheDocument();
    expect(
      within(result).getByText('The #fragment is not checked'),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', {
        name: 'Show only URLs that need attention',
      }),
    );
    expect(
      screen.queryByText('https://ok.example/page#top'),
    ).not.toBeInTheDocument();
  });
});
