import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from '@testing-library/react';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelFieldPickerProps } from '../../components/BulkTranslations/ModelFieldPicker';
import { makeCtx, renderWithCanvas } from '../../test/renderWithCanvas';
import type { collectRecordIds } from '../../utils/translation/BulkRecordLoader';
import type { SdkField } from '../../utils/translation/BulkTranslationHelpers';
import type { ctxParamsType } from '../Config/ConfigScreen';
import AIBulkTranslationsPage from './AIBulkTranslationsPage';

type CollectionOptions = NonNullable<Parameters<typeof collectRecordIds>[2]>;
type SelectOption = { value: string; label: string; code?: string };
type SelectGroup = { label: string; options: SelectOption[] };

const mocks = vi.hoisted(() => ({
  buildDatoCMSClient: vi.fn(),
  collectRecordIds: vi.fn<typeof collectRecordIds>(),
  listModels: vi.fn(),
  findSite: vi.fn(),
}));

vi.mock('../../utils/clients', () => ({
  buildDatoCMSClient: mocks.buildDatoCMSClient,
}));

vi.mock('../../utils/translation/BulkRecordLoader', () => ({
  collectRecordIds: mocks.collectRecordIds,
}));

vi.mock('../../components/BulkTranslations/ModelFieldPicker', () => ({
  ModelFieldPicker: ({
    model,
    selectedApiKeys,
    loadFailed,
    validationMessage,
    onChange,
    onRetry,
  }: ModelFieldPickerProps) => (
    <div data-testid="field-picker">
      {`${model.label} fields: ${selectedApiKeys.join(', ')}`}
      <button type="button" onClick={() => onChange([])}>
        {`Clear ${model.code} fields`}
      </button>
      {loadFailed && (
        <button type="button" onClick={onRetry}>
          {`Retry ${model.code} fields`}
        </button>
      )}
      {validationMessage && <span>{validationMessage}</span>}
    </div>
  ),
}));

/**
 * SelectInput stand-in keyed by `name`: one "Pick {name} {value}" button per
 * option (multi selects append to the current value), and a "Clear {name}"
 * button for multi selects. It calls `onChange` like the kit: the value(s),
 * then the chosen option(s). The field's error comes from the real
 * FieldWrapper around it.
 */
vi.mock('datocms-react-ui/SelectInput', () => ({
  default: ({
    name,
    value,
    multiple,
    options,
    acceptValueNotIncludedInOptions,
    onChange,
  }: {
    name: string;
    value: string | string[] | null;
    multiple?: boolean;
    options: readonly (SelectOption | SelectGroup)[];
    acceptValueNotIncludedInOptions?: (
      value: string,
    ) => SelectOption | undefined;
    onChange: (value: unknown, options: unknown) => void;
  }) => {
    const flat = options.flatMap((entry) =>
      'options' in entry ? entry.options : [entry],
    );
    const current = Array.isArray(value) ? value : [];
    const toOptions = (values: string[]) =>
      values.flatMap((v) => {
        const option =
          flat.find((candidate) => candidate.value === v) ??
          acceptValueNotIncludedInOptions?.(v);
        return option ? [option] : [];
      });
    return (
      <div data-testid={`select-${name}`}>
        {flat.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => {
              if (multiple) {
                const next = [...current, option.value];
                onChange(next, toOptions(next));
              } else {
                onChange(option.value, option);
              }
            }}
          >
            {`Pick ${name} ${option.value}`}
          </button>
        ))}
        {multiple && (
          <button type="button" onClick={() => onChange([], [])}>
            {`Clear ${name}`}
          </button>
        )}
      </div>
    );
  },
}));

const pluginParams: ctxParamsType = {
  vendor: 'openai',
  apiKey: 'provider-key',
  gptModel: 'test-model',
  translationFields: ['single_line'],
  translateWholeRecord: true,
  translateBulkRecords: true,
  prompt: '',
  modelsToBeExcludedFromThisPlugin: [],
  rolesToBeExcludedFromThisPlugin: [],
  apiKeysToBeExcludedFromThisPlugin: [],
  enableDebugging: false,
};

const fields: SdkField[] = [
  {
    id: 'title-field',
    attributes: {
      api_key: 'title',
      label: 'Title',
      localized: true,
      position: 0,
      appearance: { editor: 'single_line' },
    },
  },
  {
    id: 'internal-field',
    attributes: {
      api_key: 'internal_name',
      label: 'Internal name',
      localized: false,
      position: 1,
      appearance: { editor: 'single_line' },
    },
  },
];

const extraModels = [
  {
    id: 'landing_page',
    api_key: 'landing_page',
    name: 'Landing page',
    modular_block: false,
  },
  {
    id: 'site_settings',
    api_key: 'site_settings',
    name: 'Site settings',
    modular_block: false,
  },
  { id: 'hero', api_key: 'hero', name: 'Hero block', modular_block: true },
];

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function renderPage(
  overrides: {
    pluginParams?: ctxParamsType;
    loadItemTypeFields?: (modelId: string) => Promise<SdkField[]>;
    currentUserAccessToken?: string | null;
    canEditEnvironment?: boolean;
  } = {},
) {
  const ctx = {
    currentUserAccessToken:
      overrides.currentUserAccessToken === undefined
        ? 'cma-token'
        : overrides.currentUserAccessToken,
    environment: 'main',
    isEnvironmentPrimary: true,
    cmaBaseUrl: 'https://cma.example.test',
    plugin: {
      id: 'plugin-id',
      attributes: { parameters: overrides.pluginParams ?? pluginParams },
    },
    currentRole: {
      meta: {
        final_permissions: {
          can_edit_environment: overrides.canEditEnvironment ?? true,
          can_edit_schema: true,
        },
      },
    },
    loadItemTypeFields: overrides.loadItemTypeFields
      ? vi.fn(overrides.loadItemTypeFields)
      : vi.fn().mockResolvedValue(fields),
    openModal:
      vi.fn<
        (options: {
          id: string;
          parameters?: Record<string, unknown>;
        }) => Promise<unknown>
      >(),
    notice: vi.fn().mockResolvedValue(undefined),
    alert: vi.fn().mockResolvedValue(undefined),
    customToast: vi.fn().mockResolvedValue(null),
    navigateTo: vi.fn().mockResolvedValue(undefined),
  };
  const pageCtx = makeCtx<RenderPageCtx>(ctx);
  const view = renderWithCanvas(
    <AIBulkTranslationsPage ctx={pageCtx} />,
    pageCtx,
  );
  /** Renders the page again with a new ctx, as a host ctx update does. */
  const update = (changes: Record<string, unknown> = {}) => {
    const next = makeCtx<RenderPageCtx>({ ...ctx, ...changes });
    view.rerender(<AIBulkTranslationsPage ctx={next} />, next);
  };
  return { ctx, update, ...view };
}

function primaryButton() {
  return screen.getByRole('button', { name: 'Translate records' });
}

/** The button can be pressed: not disabled, not busy, no disabled reason. */
function expectEnabled(button: HTMLElement) {
  expect(button).not.toBeDisabled();
  expect(button).not.toHaveAttribute('aria-disabled');
  expect(button).not.toHaveAttribute('aria-busy');
}

/** The button is disabled and explains why in its tooltip. */
async function expectDisabledWithReason(button: HTMLElement, reason: string) {
  expect(button).toHaveAttribute('aria-disabled', 'true');
  act(() => button.focus());
  expect((await screen.findByRole('tooltip')).textContent).toBe(reason);
}

async function selectModel(modelId = 'article') {
  fireEvent.click(
    await screen.findByRole('button', {
      name: `Pick selectedModels ${modelId}`,
    }),
  );
  await waitFor(() => expectEnabled(primaryButton()));
  return primaryButton();
}

describe('AIBulkTranslationsPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.listModels.mockResolvedValue([
      {
        id: 'article',
        api_key: 'article',
        name: 'Articles',
        modular_block: false,
      },
    ]);
    mocks.findSite.mockResolvedValue({ locales: ['en', 'it'] });
    mocks.buildDatoCMSClient.mockReturnValue({
      itemTypes: { list: mocks.listModels },
      site: { find: mocks.findSite },
    });
  });

  afterEach(cleanup);

  it('titles the page and explains it in the help', async () => {
    renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Bulk translations' }),
    ).toBeTruthy();
    expect(screen.getByText('Loading models and locales')).toBeTruthy();
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Locales' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Models' }),
    ).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
  });

  it('shows determinate record discovery progress once the total is known and cancels the pending load', async () => {
    const collection = deferred<string[]>();
    let collectionOptions: CollectionOptions | undefined;
    mocks.collectRecordIds.mockImplementation((_client, _modelIds, options) => {
      collectionOptions = options;
      return collection.promise;
    });
    const { ctx } = renderPage();
    fireEvent.click(await selectModel());

    expect(
      screen.getByRole('heading', { level: 2, name: 'Finding records' }),
    ).toBeTruthy();
    // Before the total is known, a spinner stands in for the bar.
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Counting records…');
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    expect(ctx.openModal).not.toHaveBeenCalled();
    expect(mocks.collectRecordIds).toHaveBeenCalledWith(
      expect.anything(),
      ['article'],
      expect.objectContaining({ abortSignal: expect.any(AbortSignal) }),
    );

    act(() => {
      collectionOptions?.onProgress?.({
        loaded: 500,
        total: 2882,
        modelId: 'article',
      });
    });

    const progress = screen.getByRole('progressbar', {
      name: 'Finding records',
    });
    // The kit reports the share as a percentage: 500 / 2882 ≈ 17%.
    expect(progress.getAttribute('aria-valuenow')).toBe('17');
    expect(progress.getAttribute('aria-valuemax')).toBe('100');
    expect(screen.getByRole('status').textContent).toBe(
      `${(500).toLocaleString()} of ${(2882).toLocaleString()} records found`,
    );
    const busy = primaryButton();
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');

    fireEvent.click(cancel);

    // The busy Cancel is disabled and can't hold the focus: the status line
    // holds it until the discovery stops.
    expect(document.activeElement).toBe(screen.getByRole('status'));
    expect(collectionOptions?.abortSignal?.aborted).toBe(true);
    expect(collectionOptions?.checkCancellation?.()).toBe(true);
    // The discovery ends when its current request returns: until then the
    // Cancel shows that it is stopping.
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(mocks.buildDatoCMSClient).toHaveBeenLastCalledWith(
      'cma-token',
      'main',
      'https://cma.example.test',
    );
    await act(async () => collection.resolve(['r1']));

    expect(ctx.openModal).not.toHaveBeenCalled();
    expect(ctx.alert).not.toHaveBeenCalled();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expectEnabled(primaryButton());
    // After a user cancel, the focus goes back to the submit button.
    expect(document.activeElement).toBe(primaryButton());
  });

  it('confirms the actual 2882-record selection and launches one translation job with selected fields and locales', async () => {
    const itemIds = Array.from({ length: 2882 }, (_, index) => `r${index}`);
    const collection = deferred<string[]>();
    mocks.collectRecordIds.mockReturnValue(collection.promise);
    const { ctx } = renderPage();
    ctx.openModal
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ completed: true });
    fireEvent.click(await selectModel());
    expect(ctx.openModal).not.toHaveBeenCalled();

    await act(async () => collection.resolve(itemIds));

    await waitFor(() => {
      expect(ctx.notice).toHaveBeenCalledWith(
        `${(2882).toLocaleString()} records translated.`,
      );
    });
    expect(ctx.loadItemTypeFields).toHaveBeenCalledWith('article');
    expect(ctx.openModal).toHaveBeenCalledTimes(2);
    expect(ctx.openModal).toHaveBeenNthCalledWith(1, {
      id: 'translationConfirmModal',
      title: `Translate ${(2882).toLocaleString()} records?`,
      width: 'm',
      // The footer's Cancel closes the review: no host cross.
      closeDisabled: true,
      parameters: {
        recordCount: 2882,
        fromLocale: 'en',
        toLocales: ['it'],
        vendorName: 'OpenAI',
        models: [
          {
            label: 'Articles',
            code: 'article',
            fields: [{ label: 'Title', apiKey: 'title' }],
          },
        ],
      },
    });
    expect(ctx.openModal).toHaveBeenNthCalledWith(2, {
      id: 'translationProgressModal',
      title: 'Translation progress',
      width: 'l',
      // No host cross: it would close the dialog mid-run, abort the job and
      // lose its summary. Cancel and Close are the ways out.
      closeDisabled: true,
      parameters: {
        totalRecords: 2882,
        itemIds,
        fromLocale: 'en',
        toLocales: ['it'],
        accessToken: 'cma-token',
        pluginParams,
        selectedFieldsByModel: { article: ['title'] },
      },
    });
    expect(ctx.alert).not.toHaveBeenCalled();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('does not launch translation when the user declines the confirmation', async () => {
    mocks.collectRecordIds.mockResolvedValue(['r1']);
    const { ctx } = renderPage();
    ctx.openModal.mockResolvedValue(false);
    fireEvent.click(await selectModel());

    await waitFor(() => {
      expect(ctx.openModal).toHaveBeenCalledTimes(1);
      expectEnabled(primaryButton());
    });
    expect(ctx.openModal.mock.calls[0][0].id).toBe('translationConfirmModal');
    expect(ctx.notice).not.toHaveBeenCalled();
    expect(ctx.alert).not.toHaveBeenCalled();
  });

  it('aborts discovery when the page unmounts and never opens a late modal', async () => {
    const collection = deferred<string[]>();
    let collectionOptions: CollectionOptions | undefined;
    mocks.collectRecordIds.mockImplementation((_client, _modelIds, options) => {
      collectionOptions = options;
      return collection.promise;
    });
    const { ctx, unmount } = renderPage();
    fireEvent.click(await selectModel());

    unmount();

    expect(collectionOptions?.abortSignal?.aborted).toBe(true);
    await act(async () => collection.resolve(['r1']));
    expect(ctx.openModal).not.toHaveBeenCalled();
  });

  it('explains why the primary is disabled before a model is selected', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'Pick selectedModels article' });

    const primary = primaryButton();
    fireEvent.click(primary);
    expect(mocks.collectRecordIds).not.toHaveBeenCalled();
    await expectDisabledWithReason(primary, 'Pick at least one model first.');
  });

  it('keeps the form editable and points to the plugin settings when no AI vendor is set up', async () => {
    const { ctx } = renderPage({
      pluginParams: { ...pluginParams, apiKey: '' },
    });
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Pick selectedModels article',
      }),
    );
    expect(await screen.findByText('Articles fields: title')).toBeTruthy();

    expect(
      screen.getByRole('heading', { level: 2, name: 'AI vendor' }),
    ).toBeTruthy();
    expect(screen.getByText('Not set up')).toBeTruthy();
    expect(
      screen.getByText(
        /No AI vendor is set up yet, so records can't be translated\./,
      ),
    ).toBeTruthy();
    expect(screen.getByText('Vendor credentials')).toBeTruthy();
    await expectDisabledWithReason(
      primaryButton(),
      'Set up an AI vendor in the plugin settings first.',
    );

    // The row of the problem group opens the plugin settings
    fireEvent.click(screen.getByRole('link', { name: 'Open plugin settings' }));
    expect(ctx.navigateTo).toHaveBeenCalledWith(
      '/configuration/plugins/plugin-id/edit',
    );
  });

  it('asks for another locale in a single-locale environment', async () => {
    mocks.findSite.mockResolvedValue({ locales: ['en'] });
    const { ctx } = renderPage();

    expect(await screen.findByText('Only one locale')).toBeTruthy();
    expect(
      screen.getByText(
        'This project has only English [en]. Add another locale to translate into.',
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Translate records' }),
    ).toBeNull();
    expect(screen.queryByTestId('select-selectedModels')).toBeNull();

    fireEvent.click(
      screen.getByRole('link', { name: 'Go to locale settings' }),
    );
    expect(ctx.navigateTo).toHaveBeenCalledWith(
      '/configuration/locales-and-timezone',
    );
  });

  it('asks an admin for another locale when the role cannot edit the environment', async () => {
    mocks.findSite.mockResolvedValue({ locales: ['en'] });
    renderPage({ canEditEnvironment: false });

    expect(
      await screen.findByText(
        'This project has only English [en]. Ask an admin to add another locale.',
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole('link', { name: 'Go to locale settings' }),
    ).toBeNull();
  });

  it('points to the schema when the project has no models', async () => {
    mocks.listModels.mockResolvedValue([]);
    const { ctx } = renderPage();

    expect(await screen.findByText('No models yet')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Translate records' }),
    ).toBeNull();
    expect(screen.queryByTestId('select-selectedModels')).toBeNull();

    fireEvent.click(screen.getByRole('link', { name: 'Go to schema' }));
    expect(ctx.navigateTo).toHaveBeenCalledWith('/schema');
  });

  it('shows the load error inline and retries without alerting', async () => {
    mocks.listModels.mockRejectedValueOnce(new Error('boom'));
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const { ctx } = renderPage();

    expect(
      await screen.findByText("Couldn't load models and locales"),
    ).toBeTruthy();
    expect(screen.getByText('boom')).toBeTruthy();
    expect(
      screen.getByText('Try again, or reload the page if it keeps failing.'),
    ).toBeTruthy();
    expect(ctx.alert).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(
      await screen.findByRole('button', {
        name: 'Pick selectedModels article',
      }),
    ).toBeTruthy();
    expect(mocks.listModels).toHaveBeenCalledTimes(2);
    expect(ctx.alert).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('keeps the focus through "Try again" until the load settles', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    mocks.listModels
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom again'));
    renderPage();

    const retry = await screen.findByRole('button', { name: 'Try again' });
    act(() => retry.focus());
    fireEvent.click(retry);

    // The loading slate replaces the button: the page holds the focus.
    expect(screen.getByText('Loading models and locales')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('main'));

    // It fails again: the new "Try again" takes the focus.
    expect(await screen.findByText('boom again')).toBeTruthy();
    const again = screen.getByRole('button', { name: 'Try again' });
    expect(document.activeElement).toBe(again);

    // The next retry loads the form: its submit button takes the focus.
    fireEvent.click(again);
    await screen.findByRole('button', { name: 'Pick selectedModels article' });
    expect(document.activeElement).toBe(primaryButton());
    expect(screen.getByRole('main')).not.toHaveAttribute('tabindex');
    consoleError.mockRestore();
  });

  it('points to the plugin settings when the plugin has no API token', async () => {
    const { ctx } = renderPage({ currentUserAccessToken: null });

    expect(await screen.findByText('No access to your API token')).toBeTruthy();
    expect(mocks.listModels).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: 'Translate records' }),
    ).toBeNull();

    fireEvent.click(screen.getByRole('link', { name: 'Open plugin settings' }));
    expect(ctx.navigateTo).toHaveBeenCalledWith(
      '/configuration/plugins/plugin-id/edit',
    );
  });

  it('keeps the picked source and targets when a host ctx update reloads the page', async () => {
    mocks.collectRecordIds.mockResolvedValue(['r1']);
    const { ctx, update } = renderPage();
    ctx.openModal.mockResolvedValue(false);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Pick sourceLocale it' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Pick targetLocales en' }),
    );
    await selectModel();

    const siteReload = deferred<{ locales: string[] }>();
    mocks.findSite.mockReturnValueOnce(siteReload.promise);
    update();
    await waitFor(() => {
      expect(mocks.findSite).toHaveBeenCalledTimes(2);
    });
    // A background reload never shows the spinner again.
    expect(screen.queryByText('Loading models and locales')).toBeNull();
    await act(async () => siteReload.resolve({ locales: ['en', 'it'] }));

    const primary = primaryButton();
    expectEnabled(primary);
    fireEvent.click(primary);

    await waitFor(() => {
      expect(ctx.openModal).toHaveBeenCalledTimes(1);
    });
    expect(ctx.openModal.mock.calls[0][0].parameters).toMatchObject({
      fromLocale: 'it',
      toLocales: ['en'],
    });
  });

  it('keeps the form and a running discovery when a background reload fails', async () => {
    const collection = deferred<string[]>();
    let collectionOptions: CollectionOptions | undefined;
    mocks.collectRecordIds.mockImplementation((_client, _modelIds, options) => {
      collectionOptions = options;
      return collection.promise;
    });
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const { ctx, update } = renderPage();
    fireEvent.click(await selectModel());
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();

    mocks.listModels.mockRejectedValueOnce(new Error('boom'));
    update();
    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        'Error loading data:',
        expect.any(Error),
      );
    });
    await act(async () => {});

    expect(screen.queryByText("Couldn't load models and locales")).toBeNull();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Finding records' }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(collectionOptions?.abortSignal?.aborted).toBe(true);
    await act(async () => collection.resolve(['r1']));

    expectEnabled(primaryButton());
    expect(ctx.openModal).not.toHaveBeenCalled();
    expect(ctx.alert).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('warns with a toast instead of opening a modal when the models have no records', async () => {
    mocks.collectRecordIds.mockResolvedValue([]);
    const { ctx } = renderPage();
    fireEvent.click(await selectModel());

    await waitFor(() => {
      expect(ctx.customToast).toHaveBeenCalledWith({
        type: 'warning',
        message: 'The selected models have no records.',
        dismissOnPageChange: true,
      });
    });
    expect(ctx.openModal).not.toHaveBeenCalled();
    expect(ctx.alert).not.toHaveBeenCalled();
    // The Finding records group is gone: the focus goes back to the submit.
    await waitFor(() => expect(document.activeElement).toBe(primaryButton()));
  });

  it('alerts when discovery fails and gives the focus back to the submit', async () => {
    mocks.collectRecordIds.mockRejectedValue(
      new Error('Could not load records'),
    );
    const { ctx } = renderPage();
    fireEvent.click(await selectModel());

    await waitFor(() => expect(ctx.alert).toHaveBeenCalledTimes(1));
    expect(ctx.openModal).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(primaryButton()));
  });

  it('re-enables the primary as soon as the progress modal resolves, without waiting for the toast', async () => {
    mocks.collectRecordIds.mockResolvedValue(['r1']);
    const { ctx } = renderPage();
    ctx.notice.mockReturnValue(new Promise(() => {}));
    ctx.openModal
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ completed: true });
    fireEvent.click(await selectModel());

    await waitFor(() => {
      expect(ctx.notice).toHaveBeenCalledWith('1 record translated.');
    });
    await waitFor(() => expectEnabled(primaryButton()));
  });

  it('keeps excluded models out of the selectable catalog', async () => {
    mocks.listModels.mockResolvedValue([
      {
        id: 'article',
        api_key: 'article',
        name: 'Articles',
        modular_block: false,
      },
      ...extraModels,
    ]);
    const { ctx } = renderPage({
      pluginParams: {
        ...pluginParams,
        modelsToBeExcludedFromThisPlugin: ['article'],
      },
    });
    await screen.findByRole('button', {
      name: 'Pick selectedModels landing_page',
    });
    expect(
      screen.queryByRole('button', { name: 'Pick selectedModels article' }),
    ).toBeNull();
    expect(ctx.loadItemTypeFields).not.toHaveBeenCalled();
  });

  it('discards an older environment refresh that finishes after the current one', async () => {
    const olderModels = deferred<typeof extraModels>();
    mocks.listModels
      .mockReturnValueOnce(olderModels.promise)
      .mockResolvedValueOnce([
        {
          id: 'new',
          api_key: 'new',
          name: 'Current model',
          modular_block: false,
        },
      ]);
    const { update } = renderPage();
    update({ environment: 'sandbox' });
    await screen.findByRole('button', { name: 'Pick selectedModels new' });
    await act(async () => olderModels.resolve(extraModels));
    expect(
      screen.getByRole('button', { name: 'Pick selectedModels new' }),
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', {
        name: 'Pick selectedModels landing_page',
      }),
    ).toBeNull();
  });

  it('drops removed target locales after a schema refresh before starting the job', async () => {
    mocks.findSite.mockResolvedValueOnce({ locales: ['en', 'it', 'fr'] });
    mocks.collectRecordIds.mockResolvedValue(['r1']);
    const { ctx, update } = renderPage();
    ctx.openModal.mockResolvedValue(false);
    await selectModel();
    fireEvent.click(
      screen.getByRole('button', { name: 'Pick targetLocales it' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Pick targetLocales fr' }),
    );
    mocks.findSite.mockResolvedValueOnce({ locales: ['en', 'fr'] });
    update();
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Pick targetLocales it' }),
      ).toBeNull(),
    );
    fireEvent.click(primaryButton());
    await waitFor(() => expect(ctx.openModal).toHaveBeenCalledTimes(1));
    expect(ctx.openModal.mock.calls[0][0].parameters).toMatchObject({
      toLocales: ['fr'],
    });
  });

  it('asks for a target locale when the targets are cleared', async () => {
    renderPage();
    await selectModel();

    fireEvent.click(
      screen.getByRole('button', { name: 'Clear targetLocales' }),
    );

    expect(screen.getByText('Pick at least one locale')).toBeTruthy();
    expect(screen.queryByText(/^1 model · /)).toBeNull();
    await expectDisabledWithReason(
      primaryButton(),
      'Pick at least one locale to translate into.',
    );
  });

  describe('models section', () => {
    it('shows one field picker per selected model in selection order and prunes deselected ones', async () => {
      mocks.listModels.mockResolvedValue([
        {
          id: 'article',
          api_key: 'article',
          name: 'Articles',
          modular_block: false,
        },
        ...extraModels,
      ]);
      const { ctx } = renderPage();

      expect(
        screen.queryByRole('button', { name: 'Pick selectedModels hero' }),
      ).toBeNull();
      expect(screen.queryAllByTestId('field-picker')).toHaveLength(0);

      fireEvent.click(
        await screen.findByRole('button', {
          name: 'Pick selectedModels landing_page',
        }),
      );
      await selectModel('article');

      expect(
        screen
          .getAllByTestId('field-picker')
          .map((el) => el.firstChild?.textContent),
      ).toEqual(['Landing page fields: title', 'Articles fields: title']);

      fireEvent.click(
        screen.getByRole('button', { name: 'Clear selectedModels' }),
      );
      expect(screen.queryAllByTestId('field-picker')).toHaveLength(0);
      expect(screen.getByText('Pick at least one model')).toBeTruthy();

      // Added again, the model's fields load afresh with the default picks.
      await selectModel('article');
      expect(screen.getByText('Articles fields: title')).toBeTruthy();
      expect(ctx.loadItemTypeFields).toHaveBeenCalledTimes(3);
    });

    it('asks for a field when every field of a model is cleared', async () => {
      renderPage();
      await selectModel();

      fireEvent.click(
        screen.getByRole('button', { name: 'Clear article fields' }),
      );

      expect(screen.getByText('Pick at least one field')).toBeTruthy();
      await expectDisabledWithReason(
        primaryButton(),
        'Pick at least one field of Articles first.',
      );
    });

    it("retries a model's fields after a failed load", async () => {
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      let attempts = 0;
      renderPage({
        loadItemTypeFields: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error('boom');
          return fields;
        },
      });
      fireEvent.click(
        await screen.findByRole('button', {
          name: 'Pick selectedModels article',
        }),
      );

      fireEvent.click(
        await screen.findByRole('button', { name: 'Retry article fields' }),
      );
      expect(await screen.findByText('Articles fields: title')).toBeTruthy();
      expect(attempts).toBe(2);
      consoleError.mockRestore();
    });
  });
});
