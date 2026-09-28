import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RenderItemFormSidebarPanelCtx } from 'datocms-plugin-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred, panelContext, rawRecord } from '../test/fixtures';
import RecordPanel from './RecordPanel';

vi.mock(
  'datocms-react-ui',
  async () => (await import('../test/fixtures')).reactUi,
);

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

/** The panel's one live region, mounted empty and filled when a check settles. */
async function announced(text: string) {
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent(text),
  );
}

const WARNINGS_INTRO =
  "Some content couldn't be read, so its links weren't checked:";

describe('record link-check panel', () => {
  it('checks unsaved content in every locale without a token, save or field write', async () => {
    const user = userEvent.setup();
    const ctx = panelContext({ currentUserAccessToken: undefined });
    render(<RecordPanel ctx={ctx} />);
    // Only the button: no intro, and no locale switch since every locale is checked.
    expect(screen.queryByText(/Checks the links/)).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    await user.click(screen.getByRole('button', { name: 'Check links' }));
    await announced('2 URLs need attention');
    expect(ctx.formValuesToItem).toHaveBeenCalledWith(ctx.formValues, false);
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
    expect(screen.queryByText(/Checks the links/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled();
    expect(ctx.saveCurrentItem).not.toHaveBeenCalled();
    expect(ctx.setFieldValue).not.toHaveBeenCalled();
    expect(ctx.editItem).not.toHaveBeenCalled();
  });

  it('goes to the localized containing field from the whole place row', async () => {
    const user = userEvent.setup();
    const ctx = panelContext();
    render(<RecordPanel ctx={ctx} />);
    await user.click(screen.getByRole('button', { name: 'Check links' }));
    await announced('2 URLs need attention');
    const italian = resultFor('https://italian.example/page');
    await user.click(
      within(italian).getByRole('button', {
        name: 'Go to field: Website, Italian',
      }),
    );
    expect(ctx.scrollToField).toHaveBeenCalledWith('url.it', 'it');
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
      within(resultFor('https://italian.example/page')).getByRole('button', {
        name: /^Go to field/,
      }),
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
    // The live region repeats it.
    expect(
      await screen.findByText(loading, { selector: 'p' }),
    ).toBeInTheDocument();
    // Nothing was read, so there's no "some content" intro.
    expect(screen.queryByText(WARNINGS_INTRO)).not.toBeInTheDocument();
    await announced(loading);
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
    expect(screen.getByRole('button', { name: 'Check links' })).toBeDisabled();
    expect(
      screen.getByText(
        'You cannot check links while the record is being saved',
      ),
    ).toBeInTheDocument();
    rerender(<RecordPanel ctx={{ ...ctx, isSubmitting: false }} />);
    expect(
      screen.queryByText(
        'You cannot check links while the record is being saved',
      ),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check links' }));
    const failed = "The record couldn't be read. Check again to retry.";
    expect(
      await screen.findByText(failed, { selector: 'p' }),
    ).toBeInTheDocument();
    await announced(failed);
    expect(screen.queryByText(WARNINGS_INTRO)).not.toBeInTheDocument();
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
    expect(await screen.findByText('Reading the record…')).toBeInTheDocument();
    expect(screen.getByTestId('spinner')).toHaveAttribute('data-size', '25');
    item.resolve(formItem({ en: 'https://broken.example/page' }));
    expect(
      await screen.findByText('Checking URLs (2 left)…'),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Cancel check' }));
    expect(
      await screen.findByText(/^Check canceled\. URLs that weren't checked/),
    ).toBeInTheDocument();
    await announced('Check canceled. 2 URLs need attention');
    expect(
      within(resultFor('https://broken.example/page')).getByText('Not checked'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
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
      screen.getByRole('button', {
        name: 'Go to field: Website, English',
      }),
    );
    await waitFor(() =>
      expect(ctx.alert).toHaveBeenCalledWith("Couldn't open the field!"),
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
      await screen.findByText('No links in this record', { selector: 'p' }),
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
        attributes: { locales: ['en'] },
      } as unknown as RenderItemFormSidebarPanelCtx['site'],
    });
    vi.mocked(ctx.formValuesToItem).mockResolvedValue(
      formItem({ en: 'https://ok.example/page#top' }),
    );
    render(<RecordPanel ctx={ctx} />);
    await user.click(screen.getByRole('button', { name: 'Check links' }));
    await announced('Nothing needs attention. 1 URL found');
    expect(
      screen.queryByText('https://ok.example/page#top'),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show 1 URL' }));
    const result = resultFor('https://ok.example/page#top');
    expect(within(result).getByText('Reachable')).toBeInTheDocument();
    expect(within(result).getByText('Website')).toBeInTheDocument();
    expect(
      within(result).getByRole('button', { name: 'Go to field: Website' }),
    ).toBeInTheDocument();
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
