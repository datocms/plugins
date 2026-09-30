import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
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
  ModelFieldPicker: ({ model, selectedApiKeys }: ModelFieldPickerProps) => (
    <div>{`${model.label} fields: ${selectedApiKeys.join(', ')}`}</div>
  ),
}));

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
  Spinner: () => <div data-testid="spinner" />,
  SelectField: ({
    name,
    selectInputProps,
    onChange,
  }: {
    name: string;
    selectInputProps: { options: SelectOption[] };
    onChange: (options: SelectOption | SelectOption[]) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onChange(
          name === 'selectedModels'
            ? selectInputProps.options
            : selectInputProps.options[0],
        )
      }
    >
      {name === 'selectedModels' ? 'Select models' : `Select ${name}`}
    </button>
  ),
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

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function renderPage() {
  const ctx = {
    currentUserAccessToken: 'cma-token',
    environment: 'main',
    cmaBaseUrl: 'https://cma.example.test',
    plugin: { attributes: { parameters: pluginParams } },
    loadItemTypeFields: vi.fn().mockResolvedValue(fields),
    openModal:
      vi.fn<
        (options: {
          id: string;
          parameters?: Record<string, unknown>;
        }) => Promise<unknown>
      >(),
    notice: vi.fn().mockResolvedValue(undefined),
    alert: vi.fn().mockResolvedValue(undefined),
  };
  const view = render(
    <AIBulkTranslationsPage ctx={ctx as unknown as RenderPageCtx} />,
  );
  return { ctx, ...view };
}

async function selectModel() {
  await waitFor(() => {
    expect(screen.queryByText('Loading languages and models...')).toBeNull();
  });
  fireEvent.click(screen.getByRole('button', { name: 'Select models' }));
  const start = screen.getByRole('button', { name: 'Start bulk translation' });
  await waitFor(() => {
    expect(start).toHaveProperty('disabled', false);
  });
  return start;
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
    expect(progress.getAttribute('value')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Finding records: 0');
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

    expect(progress.getAttribute('value')).toBe('500');
    expect(progress.getAttribute('max')).toBe('2882');
    expect(screen.getByRole('status').textContent).toBe(
      `Finding records: ${Number(500).toLocaleString()} of ${Number(2882).toLocaleString()}`,
    );
    expect(
      screen.getByRole('button', { name: 'Finding records…' }),
    ).toHaveProperty('disabled', true);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel loading' }));

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
    expect(screen.queryByRole('button', { name: 'Cancel loading' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Start bulk translation' }),
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
        'Successfully translated 2882 record(s) to 1 locale(s)',
      );
    });
    expect(ctx.loadItemTypeFields).toHaveBeenCalledWith('article');
    expect(ctx.openModal).toHaveBeenCalledTimes(2);
    expect(ctx.openModal).toHaveBeenNthCalledWith(1, {
      id: 'translationConfirmModal',
      title: 'Start bulk translation?',
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
      title: 'Translation Progress',
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
        screen.getByRole('button', { name: 'Start bulk translation' }),
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
});
