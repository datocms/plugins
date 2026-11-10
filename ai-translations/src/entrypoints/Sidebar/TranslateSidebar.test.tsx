import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { RenderItemFormSidebarPanelCtx } from 'datocms-plugin-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getChipRemoveButton,
  makeCtx,
  renderWithCanvas,
} from '../../test/renderWithCanvas';
import type { ctxParamsType } from '../Config/ConfigScreen';
import TranslateSidebar from './TranslateSidebar';

vi.mock('../../utils/translateRecordFields', () => ({
  translateRecordFields: vi.fn(),
}));

import { translateRecordFields } from '../../utils/translateRecordFields';

const SUCCESS_NOTICE =
  'The translations are in the form. Review them, then save the record.';

const pluginParams: ctxParamsType = {
  apiKey: 'test-key',
  gptModel: 'gpt-4',
  translationFields: ['single_line', 'slug', 'structured_text', 'rich_text'],
  translateWholeRecord: true,
  translateBulkRecords: true,
  prompt: '',
  modelsToBeExcludedFromThisPlugin: [],
  rolesToBeExcludedFromThisPlugin: [],
  apiKeysToBeExcludedFromThisPlugin: [],
  enableDebugging: false,
};

function sidebarCtx(
  overrides: {
    parameters?: Partial<ctxParamsType>;
    internalLocales?: string[];
    canEditSchema?: boolean;
  } = {},
): RenderItemFormSidebarPanelCtx {
  return makeCtx<RenderItemFormSidebarPanelCtx>({
    plugin: {
      id: 'plugin-1',
      attributes: {
        parameters: { ...pluginParams, ...overrides.parameters },
      },
    },
    itemType: {
      id: 'model-1',
      attributes: { name: 'Article', api_key: 'article' },
    },
    formValues: { internalLocales: overrides.internalLocales ?? ['en', 'it'] },
    currentRole: {
      id: 'role-1',
      meta: {
        final_permissions: { can_edit_schema: overrides.canEditSchema ?? true },
      },
    },
    environment: 'main',
    isEnvironmentPrimary: true,
    scrollToField: vi.fn(),
  });
}

/**
 * The translator calls back for one field, as the real one does. Like the
 * real one, it settles only once the field is done, so an unfinished field
 * keeps the run going until it is cancelled.
 */
function startsTitle(complete: boolean) {
  vi.mocked(translateRecordFields).mockImplementation(
    async (_ctx, _params, _targets, _source, options) => {
      options?.onStart?.('Title', 'it', 'title.it', 'title');
      if (complete) {
        options?.onComplete?.('Title', 'it', 'title.it', 'title');
        return;
      }
      await new Promise<void>((resolve) => {
        options?.abortSignal?.addEventListener('abort', () => resolve());
      });
    },
  );
}

function renderSidebar(ctx: RenderItemFormSidebarPanelCtx = sidebarCtx()) {
  renderWithCanvas(<TranslateSidebar ctx={ctx} />, ctx);
  return ctx;
}

function translateButton() {
  return screen.getByRole('button', { name: 'Translate all fields' });
}

describe('TranslateSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps field selection copy out of the compact sidebar', () => {
    renderSidebar();

    expect(screen.queryByText('Fields to translate')).toBeNull();
    expect(
      screen.queryByText(/Defaults to every translatable field/i),
    ).toBeNull();
    expect(
      screen.getByRole('combobox', { name: 'Translate from' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: 'Translate into' }),
    ).toBeInTheDocument();
    expect(screen.getByText('English [en]')).toBeInTheDocument();
    expect(screen.getByText('Italian [it]')).toBeInTheDocument();
    expect(translateButton()).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('explains why it cannot translate without a target locale', async () => {
    renderSidebar();

    fireEvent.click(getChipRemoveButton('Italian [it]'));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Pick at least one locale',
    );
    const button = translateButton();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(button);
    expect(translateRecordFields).not.toHaveBeenCalled();

    act(() => button.focus());
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Pick at least one locale to translate into.',
    );
  });

  it('scrolls to the base field path and locale from a row', async () => {
    startsTitle(false);
    const ctx = sidebarCtx();
    renderSidebar(ctx);

    fireEvent.click(translateButton());

    await waitFor(() => {
      expect(translateRecordFields).toHaveBeenCalled();
    });
    const [, , targets, source, translateOptions] =
      vi.mocked(translateRecordFields).mock.calls[0] ?? [];
    expect(targets).toEqual(['it']);
    expect(source).toBe('en');
    expect(translateOptions).not.toHaveProperty('allowedFieldApiKeys');

    const row = await screen.findByRole('button', {
      name: /^Title\s*Translating into Italian \[it\]…$/,
    });
    fireEvent.click(row);

    expect(ctx.scrollToField).toHaveBeenCalledWith('title', 'it');
  });

  it('shows a manual-save success notice after successful translation', async () => {
    startsTitle(true);
    const ctx = sidebarCtx();
    renderSidebar(ctx);

    fireEvent.click(translateButton());

    await waitFor(() => {
      expect(ctx.notice).toHaveBeenCalledWith(SUCCESS_NOTICE);
    });
    expect(ctx.notice).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', {
        name: /^Title\s*Translated into Italian \[it\]$/,
      }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(translateButton()).toBeInTheDocument();
  });

  it('goes back to the form on its own after a successful run', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    startsTitle(true);
    renderSidebar();

    fireEvent.click(translateButton());
    await screen.findByRole('button', { name: 'Done' });

    // Past the 7.5s of the success state, with room for the effect that
    // starts the timer to run first.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8500);
    });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
    });
    expect(translateButton()).toBeInTheDocument();
  });

  it('cancels a run through the ref and the abort signal', async () => {
    let cancellationCheck: (() => boolean) | undefined;
    vi.mocked(translateRecordFields).mockImplementation(
      (_ctx, _params, _targets, _source, options) => {
        cancellationCheck = options?.checkCancellation;
        options?.onStart?.('Title', 'it', 'title.it', 'title');
        return new Promise<void>((resolve) => {
          options?.abortSignal?.addEventListener('abort', () => resolve());
        });
      },
    );
    const ctx = sidebarCtx();
    renderSidebar(ctx);

    fireEvent.click(translateButton());
    const cancel = await screen.findByRole('button', { name: 'Cancel' });
    expect(cancellationCheck?.()).toBe(false);

    fireEvent.click(cancel);

    expect(cancellationCheck?.()).toBe(true);
    // The busy Cancel shows that the run is stopping: one toast at its end.
    await waitFor(() => {
      expect(ctx.notice).toHaveBeenCalledWith('Translation cancelled.');
    });
    expect(ctx.notice).toHaveBeenCalledTimes(1);
    expect(translateButton()).toBeInTheDocument();
  });

  it('moves the focus with the phase, to the button that replaces the focused one', async () => {
    // The frame has the focus: only the focused button went away.
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    let finish: () => void = () => {};
    vi.mocked(translateRecordFields).mockImplementation(
      async (_ctx, _params, _targets, _source, options) => {
        options?.onStart?.('Title', 'it', 'title.it', 'title');
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        options?.onComplete?.('Title', 'it', 'title.it', 'title');
      },
    );
    renderSidebar();

    // The run starts: the focused "Translate all fields" goes away.
    act(() => translateButton().focus());
    fireEvent.click(translateButton());
    const cancel = await screen.findByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(document.activeElement).toBe(cancel));

    // The run ends: Done replaces Cancel.
    await act(async () => finish());
    const done = await screen.findByRole('button', { name: 'Done' });
    await waitFor(() => expect(document.activeElement).toBe(done));

    // Back to the form.
    fireEvent.click(done);
    await waitFor(() => expect(document.activeElement).toBe(translateButton()));
  });

  it('gives the focus back to the form after a failed run', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    vi.mocked(translateRecordFields).mockRejectedValue(new Error('Boom'));
    renderSidebar();

    act(() => translateButton().focus());
    fireEvent.click(translateButton());

    await waitFor(() => expect(document.activeElement).toBe(translateButton()));
  });

  it('leaves the focus alone when the frame does not have it', async () => {
    // The user went on in the record's form, out of the frame.
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    startsTitle(true);
    renderSidebar();

    fireEvent.click(translateButton());
    await screen.findByRole('button', { name: 'Done' });

    expect(document.activeElement).toBe(document.body);
  });

  it('keeps the rows of a run with failures, with one alert at its end', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(translateRecordFields).mockImplementation(
      async (_ctx, _params, _targets, _source, options) => {
        options?.onStart?.('Title', 'it', 'title.it', 'title');
        options?.onStart?.('Body', 'it', 'body.it', 'body');
        options?.onStart?.('Slug', 'it', 'slug.it', 'slug');
        options?.onComplete?.('Slug', 'it', 'slug.it', 'slug');
        for (const [label, path] of [
          ['Title', 'title'],
          ['Body', 'body'],
        ]) {
          options?.onError?.(
            label,
            'it',
            `${path}.it`,
            path,
            "DeepL's usage limit is reached. Check your DeepL plan.",
          );
        }
      },
    );
    const ctx = sidebarCtx();
    renderSidebar(ctx);

    fireEvent.click(translateButton());

    await screen.findByRole('button', { name: 'Done' });
    expect(ctx.alert).toHaveBeenCalledTimes(1);
    expect(ctx.alert).toHaveBeenCalledWith(
      "Couldn't translate “Title” and “Body” into Italian [it]. DeepL's usage limit is reached. Check your DeepL plan. The other fields are in the form. Review them, then save the record.",
    );
    expect(ctx.notice).not.toHaveBeenCalledWith(SUCCESS_NOTICE);
    expect(
      screen.getByRole('button', { name: /^Title\s*Failed$/ }),
    ).toBeInTheDocument();

    // The failed rows stay until Done.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8500);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(translateButton()).toBeInTheDocument();
  });

  it('names the one field that failed, not only its locales', async () => {
    const locales = ['it', 'de', 'fr'];
    vi.mocked(translateRecordFields).mockImplementation(
      async (_ctx, _params, _targets, _source, options) => {
        for (const [label, path] of [
          ['Title', 'title'],
          ['Excerpt', 'excerpt'],
        ]) {
          for (const locale of locales) {
            options?.onStart?.(label, locale, `${path}.${locale}`, path);
            if (path === 'title') {
              options?.onComplete?.(label, locale, `${path}.${locale}`, path);
            } else {
              options?.onError?.(
                label,
                locale,
                `${path}.${locale}`,
                path,
                'DeepL returned an error: Text too long.',
              );
            }
          }
        }
      },
    );
    const ctx = sidebarCtx({ internalLocales: ['en', ...locales] });
    renderSidebar(ctx);

    fireEvent.click(translateButton());

    await screen.findByRole('button', { name: 'Done' });
    expect(ctx.alert).toHaveBeenCalledTimes(1);
    expect(ctx.alert).toHaveBeenCalledWith(
      "Couldn't translate “Excerpt” into Italian [it], German [de], and French [fr]. DeepL returned an error: Text too long. The other fields are in the form. Review them, then save the record.",
    );
  });

  it('names only the locales when every field failed in them', async () => {
    const locales = ['it', 'de', 'fr'];
    vi.mocked(translateRecordFields).mockImplementation(
      async (_ctx, _params, _targets, _source, options) => {
        for (const [label, path] of [
          ['Title', 'title'],
          ['Body', 'body'],
        ]) {
          for (const locale of locales) {
            options?.onStart?.(label, locale, `${path}.${locale}`, path);
            if (locale === 'de') {
              options?.onError?.(
                label,
                locale,
                `${path}.${locale}`,
                path,
                'DeepL returned an error: Unsupported target language.',
              );
            } else {
              options?.onComplete?.(label, locale, `${path}.${locale}`, path);
            }
          }
        }
      },
    );
    const ctx = sidebarCtx({ internalLocales: ['en', ...locales] });
    renderSidebar(ctx);

    fireEvent.click(translateButton());

    await screen.findByRole('button', { name: 'Done' });
    expect(ctx.alert).toHaveBeenCalledWith(
      "Couldn't translate into German [de]. DeepL returned an error: Unsupported target language. The other translations are in the form. Review them, then save the record.",
    );
  });

  it('reports no success when a field stops without a result', async () => {
    vi.mocked(translateRecordFields).mockImplementation(
      async (_ctx, _params, _targets, _source, options) => {
        options?.onStart?.('Title', 'it', 'title.it', 'title');
        options?.onStart?.('Body', 'it', 'body.it', 'body');
        options?.onComplete?.('Title', 'it', 'title.it', 'title');
      },
    );
    const ctx = sidebarCtx();
    renderSidebar(ctx);

    fireEvent.click(translateButton());

    await screen.findByRole('button', { name: 'Done' });
    expect(ctx.notice).not.toHaveBeenCalledWith(SUCCESS_NOTICE);
    // The field that stopped doesn't keep loading.
    expect(
      screen.getByRole('button', { name: /^Body\s*Failed$/ }),
    ).toBeInTheDocument();
  });

  it('shows one row per field, which names its failed locales and opens the first', async () => {
    vi.mocked(translateRecordFields).mockImplementation(
      async (_ctx, _params, _targets, _source, options) => {
        for (const locale of ['it', 'de', 'fr']) {
          options?.onStart?.('Title', locale, `title.${locale}`, 'title');
        }
        options?.onComplete?.('Title', 'it', 'title.it', 'title');
        options?.onError?.(
          'Title',
          'de',
          'title.de',
          'title',
          'DeepL returned an error: Text too long.',
        );
        options?.onComplete?.('Title', 'fr', 'title.fr', 'title');
      },
    );
    const ctx = sidebarCtx({ internalLocales: ['en', 'it', 'de', 'fr'] });
    renderSidebar(ctx);

    fireEvent.click(translateButton());

    await screen.findByRole('button', { name: 'Done' });
    const row = screen.getByRole('button', {
      name: /^Title\s*Translated into 2 of 3 locales\. German \[de\] failed\.$/,
    });
    expect(screen.getAllByRole('button', { name: /^Title/ })).toHaveLength(1);
    fireEvent.click(row);
    expect(ctx.scrollToField).toHaveBeenCalledWith('title', 'de');
  });

  it('shows a loading state until the first field starts', async () => {
    let finish: () => void = () => {};
    vi.mocked(translateRecordFields).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const ctx = sidebarCtx();
    renderSidebar(ctx);

    fireEvent.click(translateButton());

    expect(await screen.findByText('Preparing the fields')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();

    await act(async () => finish());
    await screen.findByRole('button', { name: 'Translate all fields' });
  });

  it('reports a thrown error and goes back to the form', async () => {
    vi.mocked(translateRecordFields).mockRejectedValue(new Error('Boom'));
    const ctx = sidebarCtx();
    renderSidebar(ctx);

    fireEvent.click(translateButton());

    await waitFor(() => {
      expect(ctx.alert).toHaveBeenCalled();
    });
    expect(translateButton()).toBeInTheDocument();
  });

  it('goes back to the form when no field has anything to translate', async () => {
    vi.mocked(translateRecordFields).mockResolvedValue(undefined);
    const ctx = sidebarCtx();
    renderSidebar(ctx);

    fireEvent.click(translateButton());

    await waitFor(() => {
      expect(ctx.notice).toHaveBeenCalledWith(
        'No translatable field has content in English [en].',
      );
    });
    expect(translateButton()).toBeInTheDocument();
  });

  it('links to the plugin settings when no vendor is set up', () => {
    const ctx = sidebarCtx({ parameters: { apiKey: '' } });
    renderSidebar(ctx);

    expect(
      screen.getByText(/No AI provider is set up yet\./),
    ).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();

    fireEvent.click(screen.getByRole('link', { name: 'plugin settings' }));

    expect(ctx.navigateTo).toHaveBeenCalledWith(
      '/configuration/plugins/plugin-1/edit',
    );
  });

  it('asks for an admin when the role cannot open the plugin settings', () => {
    renderSidebar(
      sidebarCtx({ parameters: { apiKey: '' }, canEditSchema: false }),
    );

    expect(
      screen.getByText(
        "Translation isn't set up yet. Ask an admin to set it up.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('explains that a record with one locale has nothing to translate into', () => {
    renderSidebar(sidebarCtx({ internalLocales: ['en'] }));

    expect(
      screen.getByText(
        "This record has only one locale, so there's nothing to translate it into.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
