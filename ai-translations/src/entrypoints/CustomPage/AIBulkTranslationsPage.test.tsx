import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelFieldPickerProps } from '../../components/BulkTranslations/ModelFieldPicker';
import type { collectRecordIds } from '../../utils/translation/BulkRecordLoader';
import type { SdkField } from '../../utils/translation/BulkTranslationHelpers';
import type { ctxParamsType } from '../Config/ConfigScreen';
import AIBulkTranslationsPage from './AIBulkTranslationsPage';

type CollectionOptions = NonNullable<Parameters<typeof collectRecordIds>[2]>;
type SelectOption = { value: string; label: string; code?: string };

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
 * SelectField stand-in keyed by `name`: one "Pick {name} {value}" button per
 * option (multi selects append to the current value), a "Clear {name}"
 * button for multi selects, and the error text.
 */
vi.mock('datocms-react-ui', () => ({
  Canvas: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Button: ({
    children,
    onClick,
    disabled,
  }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  ButtonLink: ({ children }: { children: ReactNode }) => (
    <a href="#test">{children}</a>
  ),
  Spinner: () => <div data-testid="spinner" />,
  Toolbar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ToolbarStack: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  ToolbarTitle: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
  Section: ({ title, children }: { title: string; children: ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactElement }) => children,
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <div role="tooltip">{children}</div>
  ),
  SelectField: ({
    name,
    value,
    error,
    onChange,
    selectInputProps,
  }: {
    name: string;
    value: SelectOption | readonly SelectOption[] | null;
    error?: string;
    onChange: (value: SelectOption | SelectOption[]) => void;
    selectInputProps: { options: SelectOption[]; isMulti?: boolean };
  }) => {
    const isMulti = selectInputProps.isMulti === true;
    const current = Array.isArray(value) ? value : [];
    return (
      <div data-testid={`select-${name}`}>
        {selectInputProps.options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(isMulti ? [...current, option] : option)}
          >
            {`Pick ${name} ${option.value}`}
          </button>
        ))}
        {isMulti && (
          <button type="button" onClick={() => onChange([])}>
            {`Clear ${name}`}
          </button>
        )}
        {error && <span>{error}</span>}
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
  } = {},
) {
  const ctx = {
    currentUserAccessToken: 'cma-token',
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
          can_edit_environment: true,
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
  const view = render(
    <AIBulkTranslationsPage ctx={ctx as unknown as RenderPageCtx} />,
  );
  return { ctx, ...view };
}

async function selectModel(modelId = 'article') {
  fireEvent.click(
    await screen.findByRole('button', {
      name: `Pick selectedModels ${modelId}`,
    }),
  );
  await waitFor(() => {
    expect(
      screen.getByRole('button', { name: 'Translate records' }),
    ).toHaveProperty('disabled', false);
  });
  return screen.getByRole('button', { name: 'Translate records' });
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

  it('shows determinate record discovery progress once the total is known and cancels the pending load', async () => {
    const collection = deferred<string[]>();
    let collectionOptions: CollectionOptions | undefined;
    mocks.collectRecordIds.mockImplementation((_client, _modelIds, options) => {
      collectionOptions = options;
      return collection.promise;
    });
    const { ctx } = renderPage();
    fireEvent.click(await selectModel());

    const progress = screen.getByRole('progressbar', {
      name: 'Record loading progress',
    });
    expect(progress.getAttribute('aria-valuenow')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Counting records…');
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

    expect(progress.getAttribute('aria-valuenow')).toBe('500');
    expect(progress.getAttribute('aria-valuemax')).toBe('2882');
    expect(screen.getByRole('status').textContent).toBe(
      `${(500).toLocaleString()} of ${(2882).toLocaleString()} records found`,
    );
    expect(screen.getByRole('button', { name: 'Please wait' })).toHaveProperty(
      'disabled',
      true,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(collectionOptions?.abortSignal?.aborted).toBe(true);
    expect(collectionOptions?.checkCancellation?.()).toBe(true);
    expect(mocks.buildDatoCMSClient).toHaveBeenLastCalledWith(
      'cma-token',
      'main',
      'https://cma.example.test',
      collectionOptions?.abortSignal,
    );
    await act(async () => collection.resolve(['r1']));

    expect(ctx.openModal).not.toHaveBeenCalled();
    expect(ctx.alert).not.toHaveBeenCalled();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Translate records' }),
    ).toHaveProperty('disabled', false);
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
        `${(2882).toLocaleString()} records successfully translated!`,
      );
    });
    expect(ctx.loadItemTypeFields).toHaveBeenCalledWith('article');
    expect(ctx.openModal).toHaveBeenCalledTimes(2);
    expect(ctx.openModal).toHaveBeenNthCalledWith(1, {
      id: 'translationConfirmModal',
      title: `Translate ${(2882).toLocaleString()} records?`,
      width: 'm',
      parameters: {
        recordCount: 2882,
        fromLocale: 'en',
        toLocales: ['it'],
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
      expect(
        screen.getByRole('button', { name: 'Translate records' }),
      ).toHaveProperty('disabled', false);
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

    expect(
      screen.getByRole('button', { name: 'Translate records' }),
    ).toHaveProperty('disabled', true);
    expect(screen.getByRole('tooltip').textContent).toBe(
      'You cannot translate records as no model is selected',
    );
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
      screen.getByText(
        'No AI vendor is set up yet. Add its credentials in the plugin settings to start translating.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Translate records' }),
    ).toHaveProperty('disabled', true);
    expect(screen.getByRole('tooltip').textContent).toBe(
      'You cannot translate records as no AI vendor is set up',
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Go to plugin settings' }),
    );
    expect(ctx.navigateTo).toHaveBeenCalledWith(
      '/configuration/plugins/plugin-id/edit',
    );
  });

  it('asks for another locale in a single-locale environment', async () => {
    mocks.findSite.mockResolvedValue({ locales: ['en'] });
    const { ctx } = renderPage();

    expect(await screen.findByText('Add another locale')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Translate records' }),
    ).toBeNull();
    expect(screen.queryByTestId('select-selectedModels')).toBeNull();

    fireEvent.click(
      screen.getByRole('button', { name: 'Go to locale settings' }),
    );
    expect(ctx.navigateTo).toHaveBeenCalledWith(
      '/configuration/locales-and-timezone',
    );
  });

  it('points to the schema when the project has no models', async () => {
    mocks.listModels.mockResolvedValue([]);
    const { ctx } = renderPage();

    expect(await screen.findByText('Still no models')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Translate records' }),
    ).toBeNull();
    expect(screen.queryByTestId('select-selectedModels')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Go to Schema' }));
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

  it('keeps the picked source and targets when a host ctx update reloads the page', async () => {
    mocks.collectRecordIds.mockResolvedValue(['r1']);
    const { ctx, rerender } = renderPage();
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
    rerender(
      <AIBulkTranslationsPage ctx={{ ...ctx } as unknown as RenderPageCtx} />,
    );
    await waitFor(() => {
      expect(mocks.findSite).toHaveBeenCalledTimes(2);
    });
    await act(async () => siteReload.resolve({ locales: ['en', 'it'] }));

    const primary = screen.getByRole('button', { name: 'Translate records' });
    expect(primary).toHaveProperty('disabled', false);
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
    const { ctx, rerender } = renderPage();
    fireEvent.click(await selectModel());
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();

    mocks.listModels.mockRejectedValueOnce(new Error('boom'));
    rerender(
      <AIBulkTranslationsPage ctx={{ ...ctx } as unknown as RenderPageCtx} />,
    );
    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        'Error loading data:',
        expect.any(Error),
      );
    });
    await act(async () => {});

    expect(screen.queryByText("Couldn't load models and locales")).toBeNull();
    expect(
      screen.getByRole('progressbar', { name: 'Record loading progress' }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(collectionOptions?.abortSignal?.aborted).toBe(true);
    await act(async () => collection.resolve(['r1']));

    expect(
      screen.getByRole('button', { name: 'Translate records' }),
    ).toHaveProperty('disabled', false);
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
        message: "Couldn't find any records in the selected models!",
        dismissOnPageChange: true,
      });
    });
    expect(ctx.openModal).not.toHaveBeenCalled();
    expect(ctx.alert).not.toHaveBeenCalled();
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
      expect(ctx.notice).toHaveBeenCalledWith(
        'One record successfully translated!',
      );
    });
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Translate records' }),
      ).toHaveProperty('disabled', false);
    });
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
    const { ctx, rerender } = renderPage();
    rerender(
      <AIBulkTranslationsPage
        ctx={{ ...ctx, environment: 'sandbox' } as unknown as RenderPageCtx}
      />,
    );
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
    const { ctx, rerender } = renderPage();
    ctx.openModal.mockResolvedValue(false);
    await selectModel();
    fireEvent.click(
      screen.getByRole('button', { name: 'Pick targetLocales it' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Pick targetLocales fr' }),
    );
    mocks.findSite.mockResolvedValueOnce({ locales: ['en', 'fr'] });
    rerender(
      <AIBulkTranslationsPage ctx={{ ...ctx } as unknown as RenderPageCtx} />,
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Pick targetLocales it' }),
      ).toBeNull(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Translate records' }));
    await waitFor(() => expect(ctx.openModal).toHaveBeenCalledTimes(1));
    expect(ctx.openModal.mock.calls[0][0].parameters).toMatchObject({
      toLocales: ['fr'],
    });
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
      expect(screen.getByText('2 models · 1 target locale')).toBeTruthy();

      fireEvent.click(
        screen.getByRole('button', { name: 'Clear selectedModels' }),
      );
      expect(screen.queryAllByTestId('field-picker')).toHaveLength(0);
      expect(screen.getByText('Field is required')).toBeTruthy();

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

      expect(screen.getByText('Field is required')).toBeTruthy();
      expect(
        screen.getByRole('button', { name: 'Translate records' }),
      ).toHaveProperty('disabled', true);
      expect(screen.getByRole('tooltip').textContent).toBe(
        'You cannot translate records as no field of Articles is selected',
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
