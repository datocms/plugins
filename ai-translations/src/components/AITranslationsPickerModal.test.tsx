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
  ModelFieldPicker: ({
    model,
    selectedApiKeys,
    pluginSettingsPath,
    onChange,
  }: ModelFieldPickerProps) => (
    <div data-testid="model-fields" data-settings={pluginSettingsPath}>
      {`${model.label} fields: ${selectedApiKeys.join(', ')}`}
      <button
        type="button"
        onClick={() => onChange(selectedApiKeys.slice(0, 1))}
      >{`Keep the first field of ${model.label}`}</button>
    </div>
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
  loadedFields: SdkField[] = fields,
) {
  const ctx = makeCtx<RenderModalCtx>({
    site: { attributes: { locales, internal_domain: null } },
    plugin: { id: 'plugin-id' },
    currentRole: { meta: { final_permissions: permissions } },
    environment: 'main',
    isEnvironmentPrimary: true,
    cmaBaseUrl: 'https://cma.example.test',
    loadItemTypeFields: vi.fn().mockResolvedValue(loadedFields),
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
    // The labels say what each select picks: no group titles repeat them.
    expect(screen.queryByRole('heading')).toBeNull();
    expect(
      screen.getByRole('combobox', { name: /^Translate from/ }),
    ).toBeTruthy();
    expect(screen.getByText('All other locales')).toBeTruthy();
    // The commitment: what the run does, above the button that starts it.
    expect(
      screen.getByText(
        "This overwrites the content in the locales you translate into, and saves each record as soon as it's translated.",
      ),
    ).toBeTruthy();
    expect(ctx.resolve).not.toHaveBeenCalled();
  });

  it('keeps the field selects of many models behind a disclosure', async () => {
    const models = Array.from({ length: 6 }, (_, index) => ({
      label: `Model ${index + 1}`,
      value: `model-${index + 1}`,
      code: `model_${index + 1}`,
    }));
    renderModal({ models });
    await waitForEnabledSubmit();

    const toggle = screen.getByRole('button', { name: 'Fields of each model' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.getByText('All the fields of every model are translated.'),
    ).toBeTruthy();
    expect(screen.queryByTestId('model-fields')).toBeNull();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByTestId('model-fields')).toHaveLength(6);
  });

  it('says that only the picked fields are translated once some are left out', async () => {
    const models = Array.from({ length: 6 }, (_, index) => ({
      label: `Model ${index + 1}`,
      value: `model-${index + 1}`,
      code: `model_${index + 1}`,
    }));
    const body: SdkField = {
      id: 'body-field',
      attributes: {
        api_key: 'body',
        label: 'Body',
        localized: true,
        position: 1,
        appearance: { editor: 'single_line' },
      },
    };
    renderModal({ models }, undefined, undefined, [...fields, body]);
    await waitForEnabledSubmit();

    const toggle = screen.getByRole('button', { name: 'Fields of each model' });
    fireEvent.click(toggle);
    fireEvent.click(
      screen.getByRole('button', { name: 'Keep the first field of Model 1' }),
    );
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.getByText('Only the fields you picked are translated.'),
    ).toBeTruthy();
    expect(
      screen.queryByText('All the fields of every model are translated.'),
    ).toBeNull();
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
      },
    });
  });

  it('resolves the specific target locales picked in the select', async () => {
    const ctx = renderModal({}, ['en', 'it', 'fr']);
    await screen.findByText('Blog post fields: title');

    const targets = screen.getByRole('combobox', { name: /^Translate into/ });
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
    const targets = screen.getByRole('combobox', { name: /^Translate into/ });

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

  it('shows the missing vendor with only a Close, not a form that cannot be used', async () => {
    const ctx = renderModal({ pluginParams: { ...pluginParams, apiKey: '' } });
    await waitFor(() => expect(ctx.loadItemTypeFields).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

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
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Translate/ })).toBeNull();
    // Nothing acts on the selection: the callout and Close are the dialog.
    expect(screen.queryByText(/You selected/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(ctx.resolve).toHaveBeenCalledWith(PICKER_DISMISSED);
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

  it('asks for an admin when the role cannot open the settings', async () => {
    const ctx = renderModal(
      { pluginParams: { ...pluginParams, apiKey: '' } },
      ['en', 'it'],
      { can_edit_schema: false, can_edit_environment: false },
    );
    await waitFor(() => expect(ctx.loadItemTypeFields).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // The vendor is a setting that this role never sees.
    const callout = screen
      .getByText('Translation not set up')
      .closest('[role="alert"]');
    expect(callout?.textContent).toContain('Ask an admin to set it up.');
    expect(screen.queryByText(/AI vendor/)).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();

    cleanup();
    const single = renderModal({}, ['en'], {
      can_edit_schema: false,
      can_edit_environment: false,
    });
    await waitFor(() => expect(single.loadItemTypeFields).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(
      screen.getByText(
        "There's nothing to translate these records into. Ask an admin to add another locale.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('loads only eligible models and submits an explicit empty allowlist for excluded ones', async () => {
    const ctx = renderModal({
      itemIds: ['r1', 'r2', 'r3'],
      models: [
        {
          label: 'Blog post',
          value: 'blog',
          code: 'blog_post',
          recordCount: 2,
        },
        {
          label: 'Author',
          value: 'excluded',
          code: 'excluded_model',
          recordCount: 1,
        },
      ],
      pluginParams: {
        ...pluginParams,
        modelsToBeExcludedFromThisPlugin: ['excluded_model'],
      },
    });
    await screen.findByText('Blog post fields: title');
    // The intro says the selection; the callout under it names the skipped
    // records, and the submit counts the records that are translated.
    const intro = screen.getByText((_, element) => {
      return (
        element?.tagName === 'P' &&
        element.textContent === 'You selected 3 records from 2 models.'
      );
    });
    const skipped = screen.getByText(
      '1 Author record will be skipped: Author is excluded in the plugin settings.',
    );
    expect(
      intro.compareDocumentPosition(skipped) & Node.DOCUMENT_POSITION_FOLLOWING,
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

  it('gives the plugin settings to the field pickers only for a role that can open them', async () => {
    renderModal();
    expect(
      (await screen.findByTestId('model-fields')).getAttribute('data-settings'),
    ).toBe('/configuration/plugins/plugin-id/edit');

    cleanup();
    renderModal({}, ['en', 'it'], {
      can_edit_schema: false,
      can_edit_environment: true,
    });
    expect(
      (await screen.findByTestId('model-fields')).hasAttribute('data-settings'),
    ).toBe(false);
  });

  it('shows only the problem and a Close when no model has a field to translate', async () => {
    const ctx = renderModal({}, ['en', 'it'], undefined, []);
    await waitFor(() => expect(ctx.loadItemTypeFields).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const callout = screen
      .getByText('Nothing to translate')
      .closest('[role="alert"]');
    expect(callout?.textContent).toContain(
      'Blog post has no fields that the plugin translates. Allow more field types in the plugin settings.',
    );
    expect(
      screen.getByRole('link', { name: 'plugin settings' }),
    ).toHaveAttribute('target', '_blank');
    expect(screen.queryByText(/This replaces/)).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(ctx.resolve).toHaveBeenCalledWith(PICKER_DISMISSED);

    // A role that can't open the settings is told who to ask.
    cleanup();
    const editor = renderModal(
      {},
      ['en', 'it'],
      { can_edit_schema: false, can_edit_environment: false },
      [],
    );
    await waitFor(() => expect(editor.loadItemTypeFields).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(
      screen.getByText(
        'Blog post has no fields that the plugin translates. Ask an admin to allow more field types.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
