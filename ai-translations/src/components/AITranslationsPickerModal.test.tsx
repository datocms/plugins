import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from '@testing-library/react';
import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ctxParamsType } from '../entrypoints/Config/ConfigScreen';
import { makeCtx, renderWithCanvas } from '../test/renderWithCanvas';
import type { SdkField } from '../utils/translation/BulkTranslationHelpers';
import AITranslationsPickerModal, {
  type AITranslationsPickerModalParams,
  PICKER_DISMISSED,
} from './AITranslationsPickerModal';
import type { ModelFieldPickerProps } from './BulkTranslations/ModelFieldPicker';

vi.mock('./BulkTranslations/ModelFieldPicker', () => ({
  ModelFieldPicker: ({ model, selectedApiKeys }: ModelFieldPickerProps) => (
    <div data-testid="model-fields">{`${model.label} fields: ${selectedApiKeys.join(', ')}`}</div>
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
];

function renderModal(
  overrides: Partial<AITranslationsPickerModalParams> = {},
  locales: string[] = ['en', 'it'],
  permissions = { can_edit_schema: true, can_edit_environment: true },
) {
  const ctx = makeCtx<RenderModalCtx>({
    site: { attributes: { locales, internal_domain: null } },
    plugin: { id: 'plugin-id' },
    currentRole: { meta: { final_permissions: permissions } },
    environment: 'main',
    isEnvironmentPrimary: true,
    cmaBaseUrl: 'https://cma.example.test',
    loadItemTypeFields: vi.fn().mockResolvedValue(fields),
    resolve: vi.fn(),
    alert: vi.fn().mockResolvedValue(undefined),
  });
  const parameters: AITranslationsPickerModalParams = {
    itemIds: ['r1', 'r2'],
    models: [{ label: 'Blog post', value: 'blog', code: 'blog_post' }],
    pluginParams,
    accessToken: 'cma-token',
    ...overrides,
  };
  renderWithCanvas(
    <AITranslationsPickerModal ctx={ctx} parameters={parameters} />,
    ctx,
  );
  return ctx;
}

function submitButton() {
  return screen.getByRole('button', { name: 'Translate 2 records' });
}

/**
 * The enabled submit. It is queried again on each try: the button that is
 * disabled with a reason sits in a tooltip trigger, so enabling it renders a
 * new element.
 */
async function waitForEnabledSubmit() {
  return waitFor(() => {
    const submit = submitButton();
    expect(submit).not.toHaveAttribute('aria-disabled', 'true');
    return submit;
  });
}

describe('AITranslationsPickerModal', () => {
  afterEach(cleanup);

  it('introduces the selection', async () => {
    const ctx = renderModal();
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
    expect(
      screen.getByRole('heading', { level: 2, name: 'Locales' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Fields' }),
    ).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Locales' })).toBeTruthy();
    expect(screen.getByText('All other locales')).toBeTruthy();
    expect(ctx.resolve).not.toHaveBeenCalled();
  });

  it('dismisses with its Cancel, as the host draws no cross', async () => {
    const ctx = renderModal();
    await screen.findByText('Blog post fields: title');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(ctx.resolve).toHaveBeenCalledTimes(1);
    expect(ctx.resolve).toHaveBeenCalledWith(PICKER_DISMISSED);
  });

  it('dismisses on Escape, as the Cancel of its footer', async () => {
    const ctx = renderModal();
    await screen.findByText('Blog post fields: title');

    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });

    expect(ctx.resolve).toHaveBeenCalledTimes(1);
    expect(ctx.resolve).toHaveBeenCalledWith(PICKER_DISMISSED);
  });

  it('resolves the unchanged config shape on submit', async () => {
    const ctx = renderModal();
    const submit = await waitForEnabledSubmit();

    fireEvent.click(submit);

    expect(ctx.resolve).toHaveBeenCalledTimes(1);
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

  it('resolves the specific target locales picked in the select', async () => {
    const ctx = renderModal({}, ['en', 'it', 'fr']);
    await screen.findByText('Blog post fields: title');

    const targets = screen.getByRole('combobox', { name: /^Target locales/ });
    fireEvent.keyDown(targets, { key: 'ArrowDown' });
    fireEvent.click(screen.getByRole('option', { name: 'French [fr]' }));
    // A specific locale replaces "All other locales".
    expect(screen.queryByText('All other locales')).toBeNull();

    fireEvent.click(await waitForEnabledSubmit());

    expect(ctx.resolve).toHaveBeenCalledWith({
      config: expect.objectContaining({ fromLocale: 'en', toLocales: ['fr'] }),
    });
  });

  it('keeps Enter in a closed select from submitting, and lets it pick an open option', async () => {
    const ctx = renderModal({}, ['en', 'it', 'fr']);
    await waitForEnabledSubmit();
    const targets = screen.getByRole('combobox', { name: /^Target locales/ });

    // Closed menu: the form's guard prevents the implicit submission.
    expect(fireEvent.keyDown(targets, { key: 'Enter' })).toBe(false);
    expect(ctx.resolve).not.toHaveBeenCalled();

    // Open menu: Enter still picks the focused option.
    fireEvent.keyDown(targets, { key: 'ArrowDown' });
    fireEvent.keyDown(targets, { key: 'ArrowDown' });
    fireEvent.keyDown(targets, { key: 'Enter' });
    expect(screen.queryByText('All other locales')).toBeNull();
    expect(ctx.resolve).not.toHaveBeenCalled();
  });

  it('disables the submit with the provider reason when credentials are missing', async () => {
    const ctx = renderModal({ pluginParams: { ...pluginParams, apiKey: '' } });
    await screen.findByText('Blog post fields: title');

    const callout = screen
      .getByText('No AI vendor set up')
      .closest('[role="alert"]');
    expect(callout?.textContent).toContain(
      "These records can't be translated yet. Add the credentials of an AI vendor in the plugin settings.",
    );
    // The next step is a link that opens in a new tab, so the dialog stays.
    const settingsLink = screen.getByRole('link', { name: 'plugin settings' });
    expect(settingsLink).toHaveAttribute(
      'href',
      '/configuration/plugins/plugin-id/edit',
    );
    expect(settingsLink).toHaveAttribute('target', '_blank');
    const submit = submitButton();
    expect(submit).toHaveAttribute('aria-disabled', 'true');

    act(() => submit.focus());
    expect((await screen.findByRole('tooltip')).textContent).toBe(
      'Set up an AI vendor in the plugin settings first.',
    );

    fireEvent.click(submit);
    expect(ctx.resolve).not.toHaveBeenCalled();
  });

  it('shows the single-locale callout with only a Close', async () => {
    const ctx = renderModal({}, ['en']);
    // Let the field load of the selected model settle inside act
    await waitFor(() => expect(ctx.loadItemTypeFields).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const callout = screen
      .getByText('Only one locale')
      .closest('[role="alert"]');
    expect(callout?.textContent).toContain(
      "There's nothing to translate these records into. Add another locale in the Locales & Timezone settings first.",
    );
    expect(
      screen.getByRole('link', { name: 'Locales & Timezone settings' }),
    ).toHaveAttribute('href', '/configuration/locales-and-timezone');
    expect(screen.queryByRole('heading', { name: 'Locales' })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Translate/ })).toBeNull();
    expect(ctx.resolve).not.toHaveBeenCalled();

    // With nothing to start, Close is the only way out of the dialog.
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(ctx.resolve).toHaveBeenCalledWith(PICKER_DISMISSED);
  });

  it('names the settings pages as plain text for roles that cannot open them', async () => {
    const ctx = renderModal(
      { pluginParams: { ...pluginParams, apiKey: '' } },
      ['en'],
      { can_edit_schema: false, can_edit_environment: false },
    );
    await waitFor(() => expect(ctx.loadItemTypeFields).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.getByText(/in the plugin settings\./)).toBeTruthy();
    expect(
      screen.getByText(/in the Locales & Timezone settings first\./),
    ).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('loads only eligible models and submits an explicit empty allowlist for excluded ones', async () => {
    const ctx = renderModal({
      models: [
        { label: 'Blog post', value: 'blog', code: 'blog_post' },
        { label: 'Excluded', value: 'excluded', code: 'excluded_model' },
      ],
      pluginParams: {
        ...pluginParams,
        modelsToBeExcludedFromThisPlugin: ['excluded_model'],
      },
    });
    await screen.findByText('Blog post fields: title');
    expect(
      screen.getByText(
        'Records of models excluded in the plugin settings will be skipped.',
      ),
    ).toBeTruthy();
    expect(ctx.loadItemTypeFields).toHaveBeenCalledTimes(1);
    expect(ctx.loadItemTypeFields).toHaveBeenCalledWith('blog');

    fireEvent.click(await waitForEnabledSubmit());

    expect(ctx.resolve).toHaveBeenCalledWith({
      config: expect.objectContaining({
        selectedFieldsByModel: { blog: ['title'], excluded: [] },
      }),
    });
  });
});
