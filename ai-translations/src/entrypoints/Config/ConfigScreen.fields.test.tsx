import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dropFocus } from '../../test/dropFocus';
import { makeCtx, renderWithCanvas } from '../../test/renderWithCanvas';
import ConfigScreen from './ConfigScreen';

type StubOption = { label: ReactNode; value: string };
type StubGroup = { label: string; options: StubOption[] };

const { listRoles } = vi.hoisted(() => ({
  listRoles: vi.fn<() => Promise<{ id: string; name: string }[]>>(),
}));

// The selects of the screen as native selects: the options are in the DOM,
// so a test can count them. The stub takes the field's id, so the label of
// its FieldWrapper names it, and the combobox role of the kit's select
// input, which the form's Enter guard looks for.
vi.mock('datocms-react-ui/SelectInput', async () => {
  const { useFieldInput } = await import('datocms-react-ui/FieldWrapper');
  return {
    default: function SelectInputStub(props: {
      id?: string;
      value: string | string[] | null;
      multiple?: boolean;
      options?: readonly (StubOption | StubGroup)[];
      onChange?: (value: string | string[] | null) => void;
    }) {
      const field = useFieldInput(props);
      const options = (props.options ?? []).flatMap((entry) =>
        'options' in entry ? entry.options : [entry],
      );
      return (
        <select
          id={field.id}
          role="combobox"
          aria-labelledby={field['aria-labelledby']}
          multiple={props.multiple}
          value={props.value ?? (props.multiple ? [] : '')}
          onChange={(event) => {
            const picked = Array.from(
              event.target.selectedOptions,
              (option) => option.value,
            );
            props.onChange?.(props.multiple ? picked : (picked[0] ?? null));
          }}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {typeof option.label === 'string' ? option.label : option.value}
            </option>
          ))}
        </select>
      );
    },
  };
});

vi.mock('@datocms/cma-client-browser', () => ({
  buildClient: () => ({ roles: { list: listRoles } }),
}));
vi.mock('../../utils/translation/OpenAIModels', () => ({
  listRelevantOpenAIModels: vi.fn().mockResolvedValue(['test-model']),
}));
vi.mock('../../utils/translation/GeminiModels', () => ({
  listRelevantGeminiModels: vi.fn().mockResolvedValue(['test-model']),
}));
vi.mock('../../utils/translation/AnthropicModels', () => ({
  listRelevantAnthropicModels: vi.fn().mockResolvedValue(['test-model']),
}));
vi.mock('./VendorConfigs/OpenAIConfig', () => ({ default: () => null }));
vi.mock('./VendorConfigs/GeminiConfig', () => ({ default: () => null }));
vi.mock('./VendorConfigs/AnthropicConfig', () => ({ default: () => null }));
vi.mock('./VendorConfigs/DeepLConfig', () => ({ default: () => null }));
vi.mock('./VendorConfigs/YandexConfig', () => ({ default: () => null }));

type ItemTypes = RenderConfigScreenCtx['itemTypes'];
type ContextOverrides = Partial<
  Pick<
    RenderConfigScreenCtx,
    | 'itemTypes'
    | 'loadItemTypeFields'
    | 'colorScheme'
    | 'updatePluginParameters'
  >
>;
type LoadedFields = Awaited<
  ReturnType<RenderConfigScreenCtx['loadItemTypeFields']>
>;

function itemType(
  name: string,
  isBlock = false,
): NonNullable<ItemTypes[string]> {
  return {
    attributes: { name, api_key: name.toLowerCase(), modular_block: isBlock },
  } as NonNullable<ItemTypes[string]>;
}

function fields(id: string, label: string): LoadedFields {
  return [
    { id, attributes: { label, api_key: label.toLowerCase() } },
  ] as LoadedFields;
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: Error) => void = () => {};
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function context(overrides: ContextOverrides = {}): RenderConfigScreenCtx {
  return makeCtx<RenderConfigScreenCtx>({
    plugin: {
      attributes: {
        parameters: {
          vendor: 'deepl',
          apiKey: '',
          gptModel: 'test-model',
          deeplApiKey: 'test-key',
          apiKeysToBeExcludedFromThisPlugin: ['season_type'],
        },
      },
    },
    itemTypes: {
      article: itemType('Article'),
      season: itemType('Season', true),
    },
    loadItemTypeFields: vi
      .fn<RenderConfigScreenCtx['loadItemTypeFields']>()
      .mockImplementation(async (id) =>
        id === 'article'
          ? fields('title-id', 'Title')
          : fields('season-id', 'Season type'),
      ),
    site: { attributes: { locales: ['en', 'it'], internal_domain: null } },
    currentUserAccessToken: 'test-token',
    environment: 'main',
    cmaBaseUrl: 'https://site-api.datocms.com',
    updatePluginParameters: vi.fn().mockResolvedValue(undefined),
    notice: vi.fn().mockResolvedValue(undefined),
    alert: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });
}

function renderScreen(ctx: RenderConfigScreenCtx) {
  const view = renderWithCanvas(<ConfigScreen ctx={ctx} />, ctx);
  return {
    ...view,
    rerenderWith: (nextCtx: RenderConfigScreenCtx) =>
      view.rerender(<ConfigScreen ctx={nextCtx} />, nextCtx),
  };
}

function options() {
  return screen.getByLabelText('Excluded fields');
}

function saveButton() {
  return screen.getByRole('button', { name: 'Save' });
}

/** Opens the closed "Advanced" group, which holds the prompt and the debug logging. */
function openAdvanced() {
  const toggle = screen.getByRole('button', { name: 'Advanced' });
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
}

/** A change of the form: the debug logging, in the "Advanced" group. */
function toggleDebugLogging() {
  openAdvanced();
  fireEvent.click(screen.getByLabelText('Debug logging'));
}

/** The text of the tooltip of a button disabled with a reason. */
async function disabledReason(button: HTMLElement) {
  expect(button.getAttribute('aria-disabled')).toBe('true');
  act(() => button.focus());
  return (await screen.findByRole('tooltip')).textContent;
}

function updatedContext(
  ctx: RenderConfigScreenCtx,
  changes: ContextOverrides,
): RenderConfigScreenCtx {
  return { ...ctx, ...changes } as RenderConfigScreenCtx;
}

afterEach(() => {
  vi.restoreAllMocks();
  listRoles.mockReset();
});

describe('config field exclusions', () => {
  it.each([
    'openai',
    'google',
    'anthropic',
    'deepl',
    'yandex',
  ])('loads model and block fields for %s without an OpenAI key', async (vendor) => {
    listRoles.mockResolvedValue([]);
    const ctx = context();
    ctx.plugin.attributes.parameters.vendor = vendor;
    renderScreen(ctx);

    await waitFor(() =>
      expect(options().querySelectorAll('option')).toHaveLength(2),
    );
    expect(options().textContent).toContain('Title (Article)');
    expect(options().textContent).toContain('Season type (Season block)');
    expect(ctx.loadItemTypeFields).toHaveBeenCalledWith('article');
    expect(ctx.loadItemTypeFields).toHaveBeenCalledWith('season');
  });

  it('loads fields when the SDK supplies item types after the first render', async () => {
    listRoles.mockResolvedValue([]);
    const ctx = context({ itemTypes: {} });
    const view = renderScreen(ctx);
    expect(ctx.loadItemTypeFields).not.toHaveBeenCalled();

    view.rerenderWith(
      updatedContext(ctx, {
        itemTypes: { article: itemType('Article'), absent: undefined },
      }),
    );

    await waitFor(() => expect(options().textContent).toBe('Title (Article)'));
    expect(ctx.loadItemTypeFields).toHaveBeenCalledTimes(1);
  });

  it('retains options without refetching when the vendor or unrelated context changes', async () => {
    listRoles.mockResolvedValue([]);
    const ctx = context();
    const view = renderScreen(ctx);
    await waitFor(() =>
      expect(options().querySelectorAll('option')).toHaveLength(2),
    );

    fireEvent.click(screen.getByRole('radio', { name: /^Yandex Translate/ }));
    view.rerenderWith(updatedContext(ctx, { colorScheme: 'dark' }));

    expect(options().querySelectorAll('option')).toHaveLength(2);
    expect(ctx.loadItemTypeFields).toHaveBeenCalledTimes(2);
  });

  it('keeps successful model fields when another model cannot be loaded', async () => {
    listRoles.mockResolvedValue([]);
    const error = new Error('Fields unavailable');
    const reportError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const loadItemTypeFields = vi
      .fn<RenderConfigScreenCtx['loadItemTypeFields']>()
      .mockImplementation(async (id) => {
        if (id === 'season') throw error;
        return fields('title-id', 'Title');
      });
    renderScreen(context({ loadItemTypeFields }));

    await waitFor(() => expect(options().textContent).toBe('Title (Article)'));
    expect(reportError).toHaveBeenCalledWith(
      'Failed to load fields for item type season:',
      error,
    );
  });

  it('replaces old schema options and ignores obsolete asynchronous responses', async () => {
    listRoles.mockResolvedValue([]);
    const oldFields = deferred<LoadedFields>();
    const loadItemTypeFields = vi
      .fn<RenderConfigScreenCtx['loadItemTypeFields']>()
      .mockImplementation((id) =>
        id === 'article'
          ? oldFields.promise
          : Promise.resolve(fields('new-id', 'New field')),
      );
    const ctx = context({
      itemTypes: { article: itemType('Old model') },
      loadItemTypeFields,
    });
    const view = renderScreen(ctx);

    view.rerenderWith(
      updatedContext(ctx, {
        itemTypes: { newModel: itemType('New model') },
      }),
    );
    await waitFor(() =>
      expect(options().textContent).toBe('New field (New model)'),
    );
    await act(async () => oldFields.resolve(fields('old-id', 'Old field')));

    expect(options().textContent).toBe('New field (New model)');
  });

  it('refreshes renamed models and removes deleted fields from options', async () => {
    listRoles.mockResolvedValue([]);
    const ctx = context({ itemTypes: { article: itemType('Article') } });
    const view = renderScreen(ctx);
    await waitFor(() => expect(options().textContent).toBe('Title (Article)'));
    view.rerenderWith(
      updatedContext(ctx, {
        itemTypes: { article: itemType('Renamed model') },
      }),
    );
    await waitFor(() =>
      expect(options().textContent).toBe('Title (Renamed model)'),
    );

    view.rerenderWith(updatedContext(ctx, { itemTypes: {} }));
    await waitFor(() =>
      expect(options().querySelectorAll('option')).toHaveLength(0),
    );
  });

  it('deduplicates field IDs returned by schema loading', async () => {
    listRoles.mockResolvedValue([]);
    const loadItemTypeFields = vi
      .fn<RenderConfigScreenCtx['loadItemTypeFields']>()
      .mockResolvedValue(fields('shared-id', 'Shared field'));
    renderScreen(context({ loadItemTypeFields }));

    await waitFor(() =>
      expect(options().querySelectorAll('option')).toHaveLength(1),
    );
  });

  it('saves existing ID, API-key and path exclusions unchanged after loading fields', async () => {
    listRoles.mockResolvedValue([]);
    const excluded = [
      'title-id',
      'season_type',
      'content.en.title',
      'deleted-field-id',
    ];
    const ctx = context();
    ctx.plugin.attributes.parameters.apiKeysToBeExcludedFromThisPlugin =
      excluded;
    renderScreen(ctx);
    await waitFor(() =>
      expect(options().querySelectorAll('option')).toHaveLength(2),
    );
    toggleDebugLogging();
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(ctx.updatePluginParameters).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKeysToBeExcludedFromThisPlugin: excluded,
        }),
      ),
    );
    expect(ctx.notice).toHaveBeenCalledWith('Settings saved.');
    expect(ctx.alert).not.toHaveBeenCalled();
  });
});

describe('config screen form', () => {
  it('starts with the exclusions open and Save off until something changes', async () => {
    listRoles.mockResolvedValue([]);
    renderScreen(context());

    // The selects say that exclusions exist: no callout repeats it.
    expect(screen.getByLabelText('Excluded fields')).toBeInTheDocument();
    expect(screen.queryByText(/doesn't show everywhere/)).toBeNull();
    // The advanced settings use the defaults: their group is closed.
    expect(screen.getByRole('button', { name: 'Advanced' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByLabelText('Debug logging')).toBeNull();
    expect(await disabledReason(saveButton())).toBe(
      'There are no changes to save.',
    );
  });

  it('explains the missing credential of the selected vendor', async () => {
    listRoles.mockResolvedValue([]);
    const ctx = context();
    ctx.plugin.attributes.parameters.vendor = 'openai';
    renderScreen(ctx);

    expect(await disabledReason(saveButton())).toBe(
      'Enter the OpenAI API key.',
    );
  });

  it('shows the prompt only for the vendors that use one', async () => {
    listRoles.mockResolvedValue([]);
    renderScreen(context());
    openAdvanced();
    expect(screen.queryByLabelText(/^Translation prompt/)).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: /^OpenAI/ }));

    expect(screen.getByLabelText(/^Translation prompt/)).toBeInTheDocument();
    // Let the roles and the field loads of the screen settle inside act
    await waitFor(() =>
      expect(options().querySelectorAll('option')).toHaveLength(2),
    );
    await waitFor(() => expect(listRoles).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it('never saves on Enter in a closed select', async () => {
    listRoles.mockResolvedValue([]);
    const ctx = context();
    renderScreen(ctx);
    await waitFor(() =>
      expect(options().querySelectorAll('option')).toHaveLength(2),
    );
    await waitFor(() => expect(listRoles).toHaveBeenCalled());
    toggleDebugLogging();
    expect(saveButton()).not.toHaveAttribute('aria-disabled');

    // The form's guard prevents the implicit submission of the browser.
    for (const select of screen.getAllByRole('combobox')) {
      expect(fireEvent.keyDown(select, { key: 'Enter' })).toBe(false);
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(ctx.updatePluginParameters).not.toHaveBeenCalled();
  });

  it('alerts when the settings cannot be saved', async () => {
    listRoles.mockResolvedValue([]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = context({
      updatePluginParameters: vi.fn().mockRejectedValue(new Error('Offline')),
    });
    renderScreen(ctx);

    toggleDebugLogging();
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(ctx.alert).toHaveBeenCalledWith(
        "Couldn't save the settings. Try again.",
      ),
    );
    expect(ctx.notice).not.toHaveBeenCalled();
  });

  it('gives the focus back to Save once a failed save ends', async () => {
    listRoles.mockResolvedValue([]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let fail: (error: unknown) => void = () => {};
    const ctx = context({
      updatePluginParameters: vi.fn(
        () =>
          new Promise<void>((_resolve, reject) => {
            fail = reject;
          }),
      ),
    });
    renderScreen(ctx);

    toggleDebugLogging();
    act(() => saveButton().focus());
    fireEvent.click(saveButton());
    expect(saveButton()).toHaveAttribute('aria-busy', 'true');
    dropFocus();

    await act(async () => fail(new Error('Offline')));
    expect(ctx.alert).toHaveBeenCalledWith(
      "Couldn't save the settings. Try again.",
    );
    expect(saveButton()).not.toHaveAttribute('aria-busy');
    expect(saveButton()).not.toHaveAttribute('aria-disabled');
    expect(document.activeElement).toBe(saveButton());
  });

  it('keeps the focus on Save when the saved settings arrive after the save', async () => {
    listRoles.mockResolvedValue([]);
    const ctx = context();
    const { rerenderWith } = renderScreen(ctx);

    toggleDebugLogging();
    act(() => saveButton().focus());
    fireEvent.click(saveButton());
    dropFocus();
    await waitFor(() =>
      expect(ctx.notice).toHaveBeenCalledWith('Settings saved.'),
    );
    expect(document.activeElement).toBe(saveButton());

    // The host's update turns Save off with a reason, which renders a new
    // button: the focus follows it.
    const saved = {
      ...ctx,
      plugin: {
        ...ctx.plugin,
        attributes: {
          ...ctx.plugin.attributes,
          parameters: {
            ...ctx.plugin.attributes.parameters,
            ...vi.mocked(ctx.updatePluginParameters).mock.calls[0][0],
          },
        },
      },
    } as RenderConfigScreenCtx;
    rerenderWith(saved);
    expect(saveButton()).toHaveAttribute('aria-disabled', 'true');
    expect(document.activeElement).toBe(saveButton());
  });

  it('restores the defaults in the form only, with a notice', async () => {
    listRoles.mockResolvedValue([]);
    const ctx = context();
    renderScreen(ctx);

    fireEvent.click(screen.getByRole('button', { name: 'Restore defaults' }));

    expect(ctx.notice).toHaveBeenCalledWith(
      'Defaults restored. Save to apply them.',
    );
    expect(ctx.updatePluginParameters).not.toHaveBeenCalled();
    expect(
      (screen.getByRole('radio', { name: /^OpenAI/ }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      await disabledReason(
        screen.getByRole('button', { name: 'Restore defaults' }),
      ),
    ).toBe('The settings already use the defaults.');
  });

  it('shows the failure of the roles request on the roles field', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    listRoles.mockRejectedValue(new Error('Forbidden'));
    renderScreen(context());

    expect((await screen.findByRole('alert')).textContent).toContain(
      "Couldn't load the roles. Reload the page to try again.",
    );
  });
});
