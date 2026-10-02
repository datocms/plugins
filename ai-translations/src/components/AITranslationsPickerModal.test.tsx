import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { RenderModalCtx } from 'datocms-plugin-sdk';
import type {
  ButtonHTMLAttributes,
  FormEventHandler,
  ReactElement,
  ReactNode,
} from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ctxParamsType } from '../entrypoints/Config/ConfigScreen';
import type { SdkField } from '../utils/translation/BulkTranslationHelpers';
import AITranslationsPickerModal, {
  type AITranslationsPickerModalParams,
} from './AITranslationsPickerModal';
import type { ModelFieldPickerProps } from './BulkTranslations/ModelFieldPicker';

vi.mock('./BulkTranslations/ModelFieldPicker', () => ({
  ModelFieldPicker: ({ model, selectedApiKeys }: ModelFieldPickerProps) => (
    <div>{`${model.label} fields: ${selectedApiKeys.join(', ')}`}</div>
  ),
}));

vi.mock('datocms-react-ui', () => ({
  Canvas: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Form: ({
    children,
    onSubmit,
  }: {
    children: ReactNode;
    onSubmit?: FormEventHandler;
  }) => (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.(event);
      }}
    >
      {children}
    </form>
  ),
  FieldGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Button: ({
    children,
    onClick,
    disabled,
    type,
  }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button
      type={type === 'submit' ? 'submit' : 'button'}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  ),
  ButtonLink: ({ children }: { children: ReactNode }) => (
    <a href="#test">{children}</a>
  ),
  Spinner: () => <div data-testid="spinner" />,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactElement }) => children,
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <div role="tooltip">{children}</div>
  ),
  SelectField: ({ name }: { name: string }) => <div>{`select ${name}`}</div>,
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
];

function renderModal(
  overrides: Partial<AITranslationsPickerModalParams> = {},
  locales: string[] = ['en', 'it'],
) {
  const ctx = {
    site: { attributes: { locales } },
    loadItemTypeFields: vi.fn().mockResolvedValue(fields),
    resolve: vi.fn(),
    alert: vi.fn().mockResolvedValue(undefined),
  };
  const parameters: AITranslationsPickerModalParams = {
    itemIds: ['r1', 'r2'],
    models: [{ label: 'Blog post', value: 'blog', code: 'blog_post' }],
    pluginParams,
    accessToken: 'cma-token',
    ...overrides,
  };
  render(
    <AITranslationsPickerModal
      ctx={ctx as unknown as RenderModalCtx}
      parameters={parameters}
    />,
  );
  return ctx;
}

describe('AITranslationsPickerModal', () => {
  afterEach(cleanup);

  it('introduces the selection and has no Cancel button', async () => {
    renderModal();
    await screen.findByText('Blog post fields: title');

    expect(
      screen.getByText((_, element) => {
        return (
          element?.tagName === 'P' &&
          element.textContent ===
            'You selected 2 records of the Blog post model.'
        );
      }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('resolves the unchanged config shape on submit', async () => {
    const ctx = renderModal();
    const submit = screen.getByRole('button', { name: 'Translate 2 records' });
    await waitFor(() => {
      expect(submit).toHaveProperty('disabled', false);
    });

    fireEvent.click(submit);

    expect(ctx.resolve).toHaveBeenCalledWith({
      config: {
        fromLocale: 'en',
        toLocales: ['it'],
        selectedFieldsByModel: { blog: ['title'] },
        models: [
          {
            label: 'Blog post',
            code: 'blog_post',
            fields: [{ label: 'Title', apiKey: 'title' }],
          },
        ],
      },
    });
  });

  it('disables the submit with the provider reason when credentials are missing', async () => {
    const ctx = renderModal({ pluginParams: { ...pluginParams, apiKey: '' } });
    await screen.findByText('Blog post fields: title');

    expect(
      screen.getByText(
        'No AI vendor is set up yet. Add its credentials in the plugin settings to start translating.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Translate 2 records' }),
    ).toHaveProperty('disabled', true);
    expect(screen.getByRole('tooltip').textContent).toBe(
      'You cannot translate records as no AI vendor is set up',
    );
    expect(ctx.resolve).not.toHaveBeenCalled();
  });

  it('shows the single-locale callout without the form groups or submit', () => {
    renderModal({}, ['en']);

    expect(
      screen.getByText(/This environment has only one locale/),
    ).toBeTruthy();
    expect(screen.queryByText('select sourceLocale')).toBeNull();
    expect(screen.queryByRole('button', { name: /Translate/ })).toBeNull();
  });
});
