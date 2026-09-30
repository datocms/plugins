import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ConfigScreen from './ConfigScreen';

type Option = { label: string; value: string };

vi.mock('datocms-react-ui', () => ({
  Canvas: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  FieldGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Section: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Spinner: () => <div role="status">Loading</div>,
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  SwitchField: ({
    id,
    label,
    value,
    onChange,
  }: {
    id: string;
    label: string;
    value: boolean;
    onChange: (value: boolean) => void;
  }) => (
    <label htmlFor={id}>
      {label}
      <input
        id={id}
        type="checkbox"
        checked={value}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  ),
  SelectField: ({
    id,
    label,
    value,
    selectInputProps,
    onChange,
  }: {
    id: string;
    label: string;
    value: Option | Option[];
    selectInputProps: { options: Option[]; isMulti?: boolean };
    onChange: (value: Option | Option[]) => void;
  }) => {
    const selected = Array.isArray(value) ? value : [value];
    return (
      <div>
        <label htmlFor={id}>{label}</label>
        <div data-testid={`${id}-selected`}>
          {selected.map((option) => (
            <span key={option.value}>{option.label}</span>
          ))}
        </div>
        <select
          id={id}
          multiple={selectInputProps.isMulti}
          value={
            selectInputProps.isMulti
              ? selected.map((option) => option.value)
              : selected[0]?.value
          }
          onChange={(event) => {
            const options = Array.from(
              event.target.selectedOptions,
              (option) => ({
                label: option.textContent ?? '',
                value: option.value,
              }),
            );
            onChange(selectInputProps.isMulti ? options : options[0]);
          }}
        >
          {selectInputProps.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    );
  },
}));

vi.mock('@datocms/cma-client-browser', () => ({
  buildClient: () => ({ roles: { list: async () => [] } }),
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
    'itemTypes' | 'loadItemTypeFields' | 'colorScheme'
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
  return {
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
    site: { attributes: { locales: ['en', 'it'] } },
    currentUserAccessToken: 'test-token',
    environment: 'main',
    cmaBaseUrl: 'https://site-api.datocms.com',
    updatePluginParameters: vi.fn().mockResolvedValue(undefined),
    notice: vi.fn().mockResolvedValue(undefined),
    alert: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as RenderConfigScreenCtx;
}

function options() {
  return screen.getByLabelText('Fields to be excluded from translation');
}

function updatedContext(
  ctx: RenderConfigScreenCtx,
  changes: ContextOverrides,
): RenderConfigScreenCtx {
  return { ...ctx, ...changes } as RenderConfigScreenCtx;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('config field exclusions', () => {
  it.each(['openai', 'google', 'anthropic', 'deepl', 'yandex'])(
    'loads model and block fields for %s without an OpenAI key',
    async (vendor) => {
      const ctx = context();
      ctx.plugin.attributes.parameters.vendor = vendor;
      render(<ConfigScreen ctx={ctx} />);

      await waitFor(() =>
        expect(options().querySelectorAll('option')).toHaveLength(2),
      );
      expect(options().textContent).toContain('Title (Article)');
      expect(options().textContent).toContain('Season type (Season block)');
      expect(ctx.loadItemTypeFields).toHaveBeenCalledWith('article');
      expect(ctx.loadItemTypeFields).toHaveBeenCalledWith('season');
    },
  );

  it('loads fields when the SDK supplies item types after the first render', async () => {
    const ctx = context({ itemTypes: {} });
    const view = render(<ConfigScreen ctx={ctx} />);
    expect(ctx.loadItemTypeFields).not.toHaveBeenCalled();

    view.rerender(
      <ConfigScreen
        ctx={updatedContext(ctx, {
          itemTypes: { article: itemType('Article'), absent: undefined },
        })}
      />,
    );

    await waitFor(() => expect(options().textContent).toBe('Title (Article)'));
    expect(ctx.loadItemTypeFields).toHaveBeenCalledTimes(1);
  });

  it('retains options without refetching when the vendor or unrelated context changes', async () => {
    const ctx = context();
    const view = render(<ConfigScreen ctx={ctx} />);
    await waitFor(() =>
      expect(options().querySelectorAll('option')).toHaveLength(2),
    );

    fireEvent.change(screen.getByLabelText('AI Vendor'), {
      target: { value: 'yandex' },
    });
    view.rerender(
      <ConfigScreen ctx={updatedContext(ctx, { colorScheme: 'dark' })} />,
    );

    expect(options().querySelectorAll('option')).toHaveLength(2);
    expect(ctx.loadItemTypeFields).toHaveBeenCalledTimes(2);
  });

  it('keeps successful model fields when another model cannot be loaded', async () => {
    const error = new Error('Fields unavailable');
    const reportError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const loadItemTypeFields = vi
      .fn<RenderConfigScreenCtx['loadItemTypeFields']>()
      .mockImplementation(async (id) => {
        if (id === 'season') throw error;
        return fields('title-id', 'Title');
      });
    render(<ConfigScreen ctx={context({ loadItemTypeFields })} />);

    await waitFor(() => expect(options().textContent).toBe('Title (Article)'));
    expect(reportError).toHaveBeenCalledWith(
      'Failed to load fields for item type season:',
      error,
    );
  });

  it('replaces old schema options and ignores obsolete asynchronous responses', async () => {
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
    const view = render(<ConfigScreen ctx={ctx} />);

    view.rerender(
      <ConfigScreen
        ctx={updatedContext(ctx, {
          itemTypes: { newModel: itemType('New model') },
        })}
      />,
    );
    await waitFor(() =>
      expect(options().textContent).toBe('New field (New model)'),
    );
    await act(async () => oldFields.resolve(fields('old-id', 'Old field')));

    expect(options().textContent).toBe('New field (New model)');
  });

  it('refreshes renamed models and removes deleted fields from options', async () => {
    const ctx = context({ itemTypes: { article: itemType('Article') } });
    const view = render(<ConfigScreen ctx={ctx} />);
    await waitFor(() => expect(options().textContent).toBe('Title (Article)'));
    view.rerender(
      <ConfigScreen
        ctx={updatedContext(ctx, {
          itemTypes: { article: itemType('Renamed model') },
        })}
      />,
    );
    await waitFor(() =>
      expect(options().textContent).toBe('Title (Renamed model)'),
    );

    view.rerender(
      <ConfigScreen ctx={updatedContext(ctx, { itemTypes: {} })} />,
    );
    await waitFor(() =>
      expect(options().querySelectorAll('option')).toHaveLength(0),
    );
  });

  it('deduplicates field IDs returned by schema loading', async () => {
    const loadItemTypeFields = vi
      .fn<RenderConfigScreenCtx['loadItemTypeFields']>()
      .mockResolvedValue(fields('shared-id', 'Shared field'));
    render(<ConfigScreen ctx={context({ loadItemTypeFields })} />);

    await waitFor(() =>
      expect(options().querySelectorAll('option')).toHaveLength(1),
    );
  });

  it('saves existing ID, API-key and path exclusions unchanged after loading fields', async () => {
    const excluded = [
      'title-id',
      'season_type',
      'content.en.title',
      'deleted-field-id',
    ];
    const ctx = context();
    ctx.plugin.attributes.parameters.apiKeysToBeExcludedFromThisPlugin =
      excluded;
    render(<ConfigScreen ctx={ctx} />);
    await waitFor(() =>
      expect(options().querySelectorAll('option')).toHaveLength(2),
    );
    fireEvent.click(screen.getByLabelText('Enable debug logging'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(ctx.updatePluginParameters).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKeysToBeExcludedFromThisPlugin: excluded,
        }),
      ),
    );
    expect(ctx.notice).toHaveBeenCalledWith(
      'Plugin options updated successfully!',
    );
    expect(ctx.alert).not.toHaveBeenCalled();
  });
});
