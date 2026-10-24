import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listOpenAiProviderModels } from '../lib/providerModels';
import { fakeCtx } from '../test/canvas';
import ConfigScreen from './ConfigScreen';

const modelMocks = vi.hoisted(() => ({
  listProviderModels: vi.fn(),
}));

const cmaMocks = vi.hoisted(() => ({
  buildClient: vi.fn(),
  listRoles: vi.fn(),
}));

vi.mock('@datocms/cma-client-browser', () => ({
  buildClient: cmaMocks.buildClient,
}));

vi.mock('../lib/providerModels', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../lib/providerModels')>();
  return {
    ...original,
    listProviderModels: modelMocks.listProviderModels,
  };
});

const OPENAI_MODEL = {
  id: 'gpt-5.6-terra',
  label: 'gpt-5.6-terra',
  reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
};

const CLAUDE_OPUS = {
  id: 'claude-opus-4-8',
  label: 'Claude Opus 4.8',
  maxOutputTokens: 128_000,
  reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
};

const CLAUDE_SONNET = {
  id: 'claude-sonnet-5',
  label: 'Claude Sonnet 5',
  maxOutputTokens: 64_000,
  reasoningEfforts: ['low', 'high', 'max'],
};

const PARAMETERS = {
  provider: 'openai',
  openAiApiKey: 'sk-project',
  model: 'gpt-5.6-terra',
  reasoningEffort: 'medium',
  openAiFastMode: false,
  anthropicApiKey: '',
  anthropicModel: '',
  anthropicModelMaxOutputTokens: null,
  anthropicReasoningEffort: 'high',
  anthropicFastMode: false,
  additionalInstructions: '',
  readOnly: false,
  enableRecordSidebar: true,
  allowedRoleIds: ['editor-role', 'reviewer-role'],
};

const ROLES_LABEL = 'Roles that can use Dato Agent';

function createCtx({
  canEditSchema = true,
  canManageUsers = true,
  parameters = PARAMETERS,
}: {
  canEditSchema?: boolean;
  canManageUsers?: boolean;
  parameters?: Record<string, unknown>;
} = {}) {
  const updatePluginParameters = vi.fn().mockResolvedValue(undefined);
  const ctx = fakeCtx<RenderConfigScreenCtx>({
    mode: 'renderConfigScreen',
    plugin: { attributes: { parameters } },
    currentRole: {
      id: 'editor-role',
      attributes: { can_edit_schema: !canEditSchema },
      meta: {
        final_permissions: {
          can_edit_schema: canEditSchema,
          can_manage_users: canManageUsers,
        },
      },
    },
    currentUserAccessToken: 'current-user-token',
    environment: 'primary',
    cmaBaseUrl: 'https://site-api.example.com',
    updatePluginParameters,
  });

  return {
    alert: vi.mocked(ctx.alert),
    ctx,
    notice: vi.mocked(ctx.notice),
    updatePluginParameters,
  };
}

async function finishModelDiscovery() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
}

async function finishRoleDiscovery() {
  await act(async () => {
    await Promise.resolve();
  });
}

// The search input of a select. A disabled select hides it from the
// accessibility tree, thus the query goes through its label.
function combobox(name: string) {
  return screen.getByLabelText(name);
}

type GroupName = 'Model provider' | 'Agent behavior' | 'Access';

/** The form of a group of settings: it is named after the title */
function settingsForm(group: GroupName) {
  return screen.getByRole('form', { name: group });
}

/** Each group saves its own values, with the Save in its footer */
function saveButton(group: GroupName) {
  return within(settingsForm(group)).getByRole('button', { name: 'Save' });
}

async function clickSave(group: GroupName) {
  fireEvent.click(saveButton(group));
  await act(async () => {});
}

// The text that a single select shows for its value: the select draws it
// next to its search input
function shownValue(select: HTMLElement) {
  return select.parentElement?.parentElement?.textContent ?? '';
}

async function openMenu(select: HTMLElement) {
  fireEvent.keyDown(select, { key: 'ArrowDown' });
  await act(async () => {});
}

async function closeMenu(select: HTMLElement) {
  fireEvent.keyDown(select, { key: 'Escape' });
  await act(async () => {});
}

async function menuOptions(select: HTMLElement) {
  await openMenu(select);
  const options = screen
    .getAllByRole('option')
    .map((option) => option.textContent);
  await closeMenu(select);
  return options;
}

async function pickOption(select: HTMLElement, name: string) {
  await openMenu(select);
  fireEvent.click(screen.getByRole('option', { name }));
  await act(async () => {});
}

// "Refresh models" is an action in the footer of the menu of the model
async function refreshModels(select: HTMLElement) {
  await openMenu(select);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }));
  await act(async () => {});
}

// Two to five reasoning levels are radios, to compare at a glance: each
// option shows its name, then what it does. Six levels are a select.
function effortRadios() {
  return within(screen.getByRole('radiogroup', { name: 'Reasoning effort' }))
    .getAllByRole('radio')
    .map((radio) => radio.closest('label')?.textContent);
}

function checkedEffort() {
  return within(
    screen.getByRole('radiogroup', { name: 'Reasoning effort' }),
  ).getByRole('radio', { checked: true });
}

// The chosen roles show as pills, each with its name and a "Remove" button
function chosenRoles() {
  return screen
    .queryAllByRole('button', { name: 'Remove' })
    .map((button) => button.parentElement?.textContent);
}

function removeButtonOf(role: string) {
  const button = screen
    .getAllByRole('button', { name: 'Remove' })
    .find((candidate) => candidate.parentElement?.textContent === role);
  if (!button) {
    throw new Error(`The role ${role} is not chosen`);
  }
  return button;
}

describe('ConfigScreen', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    modelMocks.listProviderModels.mockReset();
    modelMocks.listProviderModels.mockResolvedValue([OPENAI_MODEL]);
    cmaMocks.buildClient.mockReset();
    cmaMocks.listRoles.mockReset();
    cmaMocks.listRoles.mockResolvedValue([
      { id: 'editor-role', name: 'Editor' },
      { id: 'reviewer-role', name: 'Reviewer' },
    ]);
    cmaMocks.buildClient.mockReturnValue({
      roles: { list: cmaMocks.listRoles },
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('uses kit fields for the provider and keeps the OpenAI default', async () => {
    const { ctx } = createCtx();
    render(<ConfigScreen ctx={ctx} />);
    await finishModelDiscovery();

    expect(
      screen.getByRole('radiogroup', { name: 'Provider' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: /^OpenAI \(ChatGPT\)/ }),
    ).toBeChecked();
    expect(
      screen.getByRole('radio', { name: /^Anthropic \(Claude\)/ }),
    ).not.toBeChecked();
    expect(screen.getByLabelText('OpenAI API key*')).toBeRequired();
    expect(screen.getByLabelText('OpenAI API key*')).toBeEnabled();
    expect(screen.getByLabelText('OpenAI API key*')).toHaveAttribute(
      'type',
      'password',
    );
    expect(combobox('OpenAI model*')).toBeRequired();
    expect(screen.getByText('1 compatible model')).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Fast mode' })).toBeEnabled();
    expect(
      screen.getByText(/premium processing.*increase API costs/i),
    ).toBeVisible();
    expect(saveButton('Model provider')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(modelMocks.listProviderModels).toHaveBeenCalledWith(
      'openai',
      'sk-project',
      expect.any(AbortSignal),
    );
  });

  it('switches provider fields without losing inactive OpenAI values', async () => {
    const { ctx } = createCtx();
    render(<ConfigScreen ctx={ctx} />);
    await finishModelDiscovery();

    fireEvent.click(
      screen.getByRole('radio', { name: /^Anthropic \(Claude\)/ }),
    );
    expect(screen.getByLabelText('Anthropic API key*')).toHaveValue('');
    expect(combobox('Claude model*')).toBeDisabled();

    modelMocks.listProviderModels.mockResolvedValueOnce([
      CLAUDE_OPUS,
      CLAUDE_SONNET,
    ]);
    fireEvent.change(screen.getByLabelText('Anthropic API key*'), {
      target: { value: 'sk-ant-project' },
    });
    expect(saveButton('Model provider')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await finishModelDiscovery();

    expect(modelMocks.listProviderModels).toHaveBeenLastCalledWith(
      'anthropic',
      'sk-ant-project',
      expect.any(AbortSignal),
    );
    expect(shownValue(combobox('Claude model*'))).toBe(CLAUDE_SONNET.label);
    expect(saveButton('Model provider')).not.toHaveAttribute('aria-disabled');

    fireEvent.click(screen.getByRole('radio', { name: /^OpenAI \(ChatGPT\)/ }));
    expect(screen.getByLabelText('OpenAI API key*')).toHaveValue('sk-project');
    expect(shownValue(combobox('OpenAI model*'))).toBe(OPENAI_MODEL.label);
  });

  it('offers only effort levels reported by the selected Claude model', async () => {
    modelMocks.listProviderModels.mockResolvedValue([
      CLAUDE_OPUS,
      CLAUDE_SONNET,
    ]);
    const { ctx } = createCtx({
      parameters: {
        ...PARAMETERS,
        provider: 'anthropic',
        openAiApiKey: '',
        anthropicApiKey: 'sk-ant-project',
      },
    });
    render(<ConfigScreen ctx={ctx} />);
    await finishModelDiscovery();

    expect(shownValue(combobox('Claude model*'))).toBe(CLAUDE_SONNET.label);
    // Three levels: radios, each with what it does under its name
    expect(checkedEffort()).toHaveAccessibleName(/^High \(Recommended\)/);
    expect(effortRadios()).toEqual([
      'LowFaster responses',
      'High (Recommended)Deeper reasoning',
      'MaxMaximum reasoning',
    ]);
  });

  it('shows a single supported level as text, with nothing to pick', async () => {
    modelMocks.listProviderModels.mockResolvedValue([
      { id: 'gpt-5-pro', label: 'gpt-5-pro', reasoningEfforts: ['high'] },
    ]);
    const { ctx, updatePluginParameters } = createCtx({
      parameters: { ...PARAMETERS, model: 'gpt-5-pro' },
    });
    render(<ConfigScreen ctx={ctx} />);
    await finishModelDiscovery();

    const effort = screen.getByLabelText('Reasoning effort');
    expect(effort.tagName).toBe('OUTPUT');
    expect(effort).toHaveTextContent('High — deeper reasoning');
    expect(effort).toHaveAccessibleDescription(
      'The selected model supports only this level.',
    );
    expect(
      screen.queryByRole('radiogroup', { name: 'Reasoning effort' }),
    ).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Reasoning effort' })).toBe(
      null,
    );

    // The model's only level replaces the saved one
    await clickSave('Model provider');
    expect(updatePluginParameters).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-5-pro', reasoningEffort: 'high' }),
    );
  });

  it('names each provider option, with what it uses and needs', async () => {
    const { ctx } = createCtx();
    render(<ConfigScreen ctx={ctx} />);
    await finishModelDiscovery();

    expect(
      within(screen.getByRole('radiogroup', { name: 'Provider' }))
        .getAllByRole('radio')
        .map((radio) => radio.closest('label')?.textContent),
    ).toEqual([
      'OpenAI (ChatGPT)Uses OpenAI models. Needs an OpenAI API key.',
      'Anthropic (Claude)Uses Anthropic models. Needs an Anthropic API key.',
    ]);
  });

  it('marks Medium as the recommended OpenAI balance', async () => {
    const { ctx } = createCtx();
    render(<ConfigScreen ctx={ctx} />);
    await finishModelDiscovery();

    expect(await menuOptions(combobox('Reasoning effort'))).toContain(
      'Medium — balanced (Recommended)',
    );
  });

  it('saves fast mode independently for OpenAI', async () => {
    const { ctx, updatePluginParameters } = createCtx();
    render(<ConfigScreen ctx={ctx} />);
    await finishModelDiscovery();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Fast mode' }));
    await clickSave('Model provider');

    expect(updatePluginParameters).toHaveBeenCalledWith(
      expect.objectContaining({
        openAiFastMode: true,
        anthropicFastMode: false,
      }),
    );
  });

  it('finishes saving without waiting for the success notice to dismiss', async () => {
    const { ctx, notice, updatePluginParameters } = createCtx();
    notice.mockReturnValue(new Promise(() => {}));
    render(<ConfigScreen ctx={ctx} />);
    await finishModelDiscovery();

    fireEvent.change(
      screen.getByRole('textbox', { name: 'Additional instructions' }),
      { target: { value: 'Use sentence case.' } },
    );
    await clickSave('Agent behavior');

    expect(updatePluginParameters).toHaveBeenCalledOnce();
    expect(notice).toHaveBeenCalledWith('Settings saved.');
    expect(saveButton('Agent behavior')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(saveButton('Agent behavior')).not.toHaveAttribute('aria-busy');
  });

  it('alerts when the settings cannot be saved', async () => {
    const { alert, ctx, notice, updatePluginParameters } = createCtx();
    updatePluginParameters.mockRejectedValueOnce(new Error('Network down'));
    render(<ConfigScreen ctx={ctx} />);
    await finishModelDiscovery();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Read-only mode' }));
    await clickSave('Access');

    expect(alert).toHaveBeenCalledWith(
      'The settings couldn’t be saved: Network down',
    );
    expect(notice).not.toHaveBeenCalled();
    expect(saveButton('Access')).toBeEnabled();
    expect(saveButton('Access')).not.toHaveAttribute('aria-disabled');
  });

  it('enables Anthropic fast mode only for supported Opus models', async () => {
    modelMocks.listProviderModels.mockResolvedValue([
      CLAUDE_OPUS,
      CLAUDE_SONNET,
    ]);
    const { ctx, updatePluginParameters } = createCtx({
      parameters: {
        ...PARAMETERS,
        provider: 'anthropic',
        openAiApiKey: '',
        anthropicApiKey: 'sk-ant-project',
      },
    });
    render(<ConfigScreen ctx={ctx} />);
    await finishModelDiscovery();

    expect(screen.getByRole('checkbox', { name: 'Fast mode' })).toBeDisabled();
    expect(screen.getByText(/requires a supported Opus model/i)).toBeVisible();

    await pickOption(combobox('Claude model*'), CLAUDE_OPUS.label);
    expect(screen.getByRole('checkbox', { name: 'Fast mode' })).toBeEnabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Fast mode' }));
    await clickSave('Model provider');

    expect(updatePluginParameters).toHaveBeenCalledWith(
      expect.objectContaining({
        anthropicFastMode: true,
        anthropicModel: CLAUDE_OPUS.id,
      }),
    );
  });

  it('selects and saves a newer OpenAI model returned by the model API', async () => {
    const fetchModels = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { id: OPENAI_MODEL.id },
            { id: 'gpt-6-astra' },
            { id: 'gpt-6.1-sol' },
            { id: 'gpt-image-2' },
          ],
        }),
      ),
    );
    modelMocks.listProviderModels.mockImplementationOnce(
      (_provider: string, apiKey: string, signal: AbortSignal) =>
        listOpenAiProviderModels(apiKey, signal, fetchModels),
    );
    const { ctx, updatePluginParameters } = createCtx({
      parameters: { ...PARAMETERS, reasoningEffort: 'none' },
    });
    render(<ConfigScreen ctx={ctx} />);
    await finishModelDiscovery();

    const model = combobox('OpenAI model*');
    const models = await menuOptions(model);
    expect(models).toContain('gpt-6.1-sol');
    expect(models).not.toContain('gpt-image-2');

    // Six levels, with None: a select
    expect(screen.getByRole('combobox', { name: 'Reasoning effort' })).toBe(
      combobox('Reasoning effort'),
    );

    await pickOption(model, 'gpt-6-astra');
    // The model has five levels, without None: High takes the place of None.
    // Five levels to compare are radios.
    expect(
      screen.queryByRole('combobox', { name: 'Reasoning effort' }),
    ).toBeNull();
    expect(effortRadios()).toEqual([
      'LowFaster responses',
      'Medium (Recommended)Balanced',
      'HighDeeper reasoning',
      'X-highIntensive reasoning',
      'MaxMaximum reasoning',
    ]);
    expect(checkedEffort()).toHaveAccessibleName(/^High/);

    await clickSave('Model provider');
    expect(updatePluginParameters).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-6-astra',
        reasoningEffort: 'high',
      }),
    );
  });

  it('refreshes available models without changing credentials or the selected model', async () => {
    modelMocks.listProviderModels.mockResolvedValueOnce([OPENAI_MODEL]);
    const { ctx } = createCtx();
    render(<ConfigScreen ctx={ctx} />);
    await finishModelDiscovery();

    modelMocks.listProviderModels.mockResolvedValueOnce([
      OPENAI_MODEL,
      { ...OPENAI_MODEL, id: 'gpt-6.1-sol', label: 'gpt-6.1-sol' },
    ]);
    // A secondary action of the select: in the footer of its menu, not in
    // a row of buttons under the field
    expect(screen.queryByRole('button', { name: 'Refresh models' })).toBeNull();
    await refreshModels(combobox('OpenAI model*'));
    expect(screen.getByText('Waiting to load models…')).toBeVisible();
    expect(combobox('OpenAI model*')).toBeDisabled();
    await finishModelDiscovery();

    expect(modelMocks.listProviderModels).toHaveBeenCalledTimes(2);
    expect(modelMocks.listProviderModels).toHaveBeenLastCalledWith(
      'openai',
      'sk-project',
      expect.any(AbortSignal),
    );
    const model = combobox('OpenAI model*');
    expect(shownValue(model)).toBe(OPENAI_MODEL.label);
    expect(await menuOptions(model)).toContain('gpt-6.1-sol');
    expect(screen.getByText('2 compatible models')).toBeVisible();
    expect(saveButton('Model provider')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('lets an empty model list be refreshed when a model becomes available', async () => {
    modelMocks.listProviderModels
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([OPENAI_MODEL]);
    const { ctx } = createCtx();
    render(<ConfigScreen ctx={ctx} />);
    await finishModelDiscovery();

    expect(
      screen.getByText('No compatible models for this API key.'),
    ).toBeVisible();
    await refreshModels(combobox('OpenAI model*'));
    await finishModelDiscovery();
    expect(shownValue(combobox('OpenAI model*'))).toBe(OPENAI_MODEL.label);
    expect(screen.getByText('1 compatible model')).toBeVisible();
  });

  it('saves the active Anthropic model selected from discovery', async () => {
    modelMocks.listProviderModels.mockResolvedValue([
      CLAUDE_OPUS,
      CLAUDE_SONNET,
    ]);
    const { ctx, updatePluginParameters } = createCtx({
      parameters: {
        ...PARAMETERS,
        provider: 'anthropic',
        openAiApiKey: '',
        anthropicApiKey: 'sk-ant-project',
      },
    });
    render(<ConfigScreen ctx={ctx} />);
    await finishModelDiscovery();

    await clickSave('Model provider');

    expect(updatePluginParameters).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'anthropic',
        openAiApiKey: '',
        model: 'gpt-5.6-terra',
        anthropicApiKey: 'sk-ant-project',
        anthropicModel: 'claude-sonnet-5',
        anthropicModelMaxOutputTokens: 64_000,
        anthropicReasoningEffort: 'high',
      }),
    );
  });

  it('normalizes model capabilities before an immediate model-switch save', async () => {
    modelMocks.listProviderModels.mockResolvedValue([
      CLAUDE_OPUS,
      CLAUDE_SONNET,
    ]);
    const { ctx, updatePluginParameters } = createCtx({
      parameters: {
        ...PARAMETERS,
        provider: 'anthropic',
        openAiApiKey: '',
        anthropicApiKey: 'sk-ant-project',
        anthropicModel: CLAUDE_OPUS.id,
        anthropicModelMaxOutputTokens: CLAUDE_OPUS.maxOutputTokens,
        anthropicReasoningEffort: 'xhigh',
      },
    });
    render(<ConfigScreen ctx={ctx} />);
    await finishModelDiscovery();

    await pickOption(combobox('Claude model*'), CLAUDE_SONNET.label);
    // From five levels to three: still radios
    expect(checkedEffort()).toHaveAccessibleName(/^High \(Recommended\)/);
    expect(effortRadios()).toHaveLength(3);
    await clickSave('Model provider');

    expect(updatePluginParameters).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'anthropic',
        anthropicModel: CLAUDE_SONNET.id,
        anthropicModelMaxOutputTokens: CLAUDE_SONNET.maxOutputTokens,
        anthropicReasoningEffort: 'high',
      }),
    );
  });

  it('offers a retry against the same active provider', async () => {
    modelMocks.listProviderModels
      .mockRejectedValueOnce(new Error('Temporary OpenAI error'))
      .mockResolvedValueOnce([OPENAI_MODEL]);
    const { ctx } = createCtx();
    render(<ConfigScreen ctx={ctx} />);

    await finishModelDiscovery();
    expect(
      screen.getByText('Couldn’t load models: Temporary OpenAI error'),
    ).toBeVisible();
    expect(combobox('OpenAI model*')).toHaveAttribute('aria-invalid', 'true');
    // Retry is an action in the footer of the menu, not a button under the
    // field: the select still opens
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(combobox('OpenAI model*')).toBeEnabled();
    await openMenu(combobox('OpenAI model*'));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    await finishModelDiscovery();

    expect(modelMocks.listProviderModels).toHaveBeenCalledTimes(2);
    expect(modelMocks.listProviderModels).toHaveBeenLastCalledWith(
      'openai',
      'sk-project',
      expect.any(AbortSignal),
    );
    expect(screen.getByText('1 compatible model')).toBeVisible();
    await openMenu(combobox('OpenAI model*'));
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Refresh models' }),
    ).toBeVisible();
    await closeMenu(combobox('OpenAI model*'));
  });

  it('saves unrelated settings when provider discovery is unavailable', async () => {
    modelMocks.listProviderModels.mockRejectedValueOnce(
      new Error('Temporary OpenAI error'),
    );
    const { ctx, updatePluginParameters } = createCtx();
    render(<ConfigScreen ctx={ctx} />);

    await finishModelDiscovery();
    expect(screen.getByText(/Temporary OpenAI error/)).toBeVisible();

    fireEvent.change(
      screen.getByRole('textbox', { name: 'Additional instructions' }),
      { target: { value: 'Use the project editorial style.' } },
    );
    expect(saveButton('Agent behavior')).toBeEnabled();
    expect(saveButton('Agent behavior')).not.toHaveAttribute('aria-disabled');
    await clickSave('Agent behavior');

    expect(updatePluginParameters).toHaveBeenCalledWith(
      expect.objectContaining({
        additionalInstructions: 'Use the project editorial style.',
        model: PARAMETERS.model,
        openAiApiKey: PARAMETERS.openAiApiKey,
      }),
    );
  });

  it('saves empty instructions as an empty string', async () => {
    const { ctx, updatePluginParameters } = createCtx({
      parameters: { ...PARAMETERS, additionalInstructions: 'Be brief.' },
    });
    render(<ConfigScreen ctx={ctx} />);
    await finishModelDiscovery();

    fireEvent.change(
      screen.getByRole('textbox', { name: 'Additional instructions' }),
      { target: { value: '' } },
    );
    await clickSave('Agent behavior');

    expect(updatePluginParameters).toHaveBeenCalledWith(
      expect.objectContaining({ additionalInstructions: '' }),
    );
  });

  it('synchronizes external settings without overwriting local edits', () => {
    const { ctx } = createCtx();
    const { rerender } = render(<ConfigScreen ctx={ctx} />);

    rerender(
      <ConfigScreen
        ctx={
          createCtx({
            parameters: { ...PARAMETERS, openAiApiKey: 'sk-external' },
          }).ctx
        }
      />,
    );
    expect(screen.getByLabelText('OpenAI API key*')).toHaveValue('sk-external');

    fireEvent.change(screen.getByLabelText('OpenAI API key*'), {
      target: { value: 'sk-local-edit' },
    });
    rerender(
      <ConfigScreen
        ctx={
          createCtx({
            parameters: { ...PARAMETERS, openAiApiKey: 'sk-newer-external' },
          }).ctx
        }
      />,
    );

    expect(screen.getByLabelText('OpenAI API key*')).toHaveValue(
      'sk-local-edit',
    );
  });

  it('validates only the selected provider inline', () => {
    const { alert, ctx, updatePluginParameters } = createCtx({
      parameters: {},
    });
    render(<ConfigScreen ctx={ctx} />);

    fireEvent.click(
      screen.getByRole('radio', { name: /^Anthropic \(Claude\)/ }),
    );
    fireEvent.click(saveButton('Model provider'));

    expect(screen.getByText('Anthropic API key is required.')).toBeVisible();
    expect(screen.getByLabelText('Anthropic API key*')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByText('Claude model is required.')).toBeVisible();
    expect(screen.queryByText('OpenAI API key is required.')).toBeNull();
    expect(updatePluginParameters).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });

  it('renders the access fields in the required order', async () => {
    const { ctx } = createCtx();
    render(<ConfigScreen ctx={ctx} />);
    await finishRoleDiscovery();

    // Each topic is a group: a card with its title
    const group = screen
      .getByRole('heading', { name: 'Access' })
      .closest('.Page__group');
    expect(group).not.toBeNull();
    expect(Array.from(group?.querySelectorAll('input') ?? [])).toEqual([
      screen.getByRole('checkbox', { name: 'Read-only mode' }),
      screen.getByRole('checkbox', { name: 'Show in record sidebars' }),
      combobox(ROLES_LABEL),
    ]);
    // Each group is a form, with the Save of its own values in its footer
    expect(document.querySelectorAll('.Page__group')).toHaveLength(3);
    expect(document.querySelectorAll('.Page__group')[2]).toBe(group);
    for (const name of [
      'Model provider',
      'Agent behavior',
      'Access',
    ] as const) {
      const form = settingsForm(name);
      expect(form.tagName).toBe('FORM');
      expect(
        within(form).getByRole('heading', { level: 2, name }),
      ).toBeVisible();
      expect(form.querySelector('.Page__group footer')).toContainElement(
        saveButton(name),
      );
    }
    expect(settingsForm('Access')).toContainElement(group as HTMLElement);
    expect(
      screen.getByText(
        'Project owners always have access. New roles must be added here.',
      ),
    ).toBeVisible();
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent),
    ).toEqual(['Model provider', 'Agent behavior', 'Access']);
  });

  it('shows every current role as an unsaved first-run draft', async () => {
    cmaMocks.listRoles.mockResolvedValue([
      { id: 'account_role', name: 'Project owner' },
      { id: 'editor-role', name: 'Editor' },
      { id: 'reviewer-role', name: 'Reviewer' },
    ]);
    const { ctx, updatePluginParameters } = createCtx({
      parameters: { ...PARAMETERS, allowedRoleIds: null },
    });
    render(<ConfigScreen ctx={ctx} />);
    await finishRoleDiscovery();

    expect(chosenRoles()).toEqual(['Editor', 'Reviewer']);
    expect(saveButton('Access')).toBeEnabled();
    expect(saveButton('Access')).not.toHaveAttribute('aria-disabled');
    expect(cmaMocks.buildClient).toHaveBeenCalledWith({
      apiToken: 'current-user-token',
      environment: 'primary',
      baseUrl: 'https://site-api.example.com',
    });

    await clickSave('Access');

    expect(updatePluginParameters).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedRoleIds: ['editor-role', 'reviewer-role'],
      }),
    );
  });

  it('saves explicit role subsets and does not opt new roles in', async () => {
    cmaMocks.listRoles.mockResolvedValue([
      { id: 'new-role', name: 'A newly created role' },
      { id: 'editor-role', name: 'Editor' },
    ]);
    const { ctx, updatePluginParameters } = createCtx({
      parameters: { ...PARAMETERS, allowedRoleIds: ['editor-role'] },
    });
    render(<ConfigScreen ctx={ctx} />);
    await finishRoleDiscovery();

    expect(chosenRoles()).toEqual(['Editor']);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Read-only mode' }));
    await clickSave('Access');

    expect(updatePluginParameters).toHaveBeenCalledWith(
      expect.objectContaining({ allowedRoleIds: ['editor-role'] }),
    );
  });

  it('adds a role picked from the role list', async () => {
    cmaMocks.listRoles.mockResolvedValue([
      { id: 'new-role', name: 'A newly created role' },
      { id: 'editor-role', name: 'Editor' },
    ]);
    const { ctx, updatePluginParameters } = createCtx({
      parameters: { ...PARAMETERS, allowedRoleIds: ['editor-role'] },
    });
    render(<ConfigScreen ctx={ctx} />);
    await finishRoleDiscovery();

    await pickOption(combobox(ROLES_LABEL), 'A newly created role');
    expect(chosenRoles()).toEqual(['Editor', 'A newly created role']);
    await clickSave('Access');

    expect(updatePluginParameters).toHaveBeenCalledWith(
      expect.objectContaining({ allowedRoleIds: ['editor-role', 'new-role'] }),
    );
  });

  it('supports explicitly clearing every collaborator role', async () => {
    const { ctx, updatePluginParameters } = createCtx();
    render(<ConfigScreen ctx={ctx} />);
    await finishRoleDiscovery();

    fireEvent.click(removeButtonOf('Editor'));
    fireEvent.click(removeButtonOf('Reviewer'));
    expect(chosenRoles()).toEqual([]);
    // The empty list is a state: only project owners can use the agent, as
    // the hint says. The placeholder says what to pick.
    expect(screen.getByText('Pick roles')).toBeVisible();
    expect(
      screen.getByText(
        'Project owners always have access. New roles must be added here.',
      ),
    ).toBeVisible();
    await clickSave('Access');

    expect(updatePluginParameters).toHaveBeenCalledWith(
      expect.objectContaining({ allowedRoleIds: [] }),
    );
  });

  it('preserves deleted role IDs as removable fallback selections', async () => {
    const { ctx, updatePluginParameters } = createCtx({
      parameters: {
        ...PARAMETERS,
        allowedRoleIds: ['editor-role', 'removed-role'],
      },
    });
    render(<ConfigScreen ctx={ctx} />);
    await finishRoleDiscovery();

    expect(chosenRoles()).toEqual([
      'Editor',
      'Unavailable role (removed-role)',
    ]);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Read-only mode' }));
    await clickSave('Access');

    expect(updatePluginParameters).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedRoleIds: ['editor-role', 'removed-role'],
      }),
    );

    fireEvent.click(removeButtonOf('Unavailable role (removed-role)'));
    await clickSave('Access');

    expect(updatePluginParameters).toHaveBeenLastCalledWith(
      expect.objectContaining({ allowedRoleIds: ['editor-role'] }),
    );
  });

  it('keeps role permissions unchanged when loading fails and retries inline', async () => {
    cmaMocks.listRoles.mockRejectedValueOnce(new Error('Temporary CMA error'));
    const { ctx, updatePluginParameters } = createCtx({
      parameters: { ...PARAMETERS, allowedRoleIds: ['editor-role'] },
    });
    render(<ConfigScreen ctx={ctx} />);
    await finishRoleDiscovery();

    expect(
      screen.getByText('Couldn’t load project roles: Temporary CMA error'),
    ).toBeVisible();
    expect(combobox(ROLES_LABEL)).toHaveAttribute('aria-invalid', 'true');
    expect(combobox(ROLES_LABEL)).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Read-only mode' }));
    await clickSave('Access');
    expect(updatePluginParameters).toHaveBeenCalledWith(
      expect.objectContaining({ allowedRoleIds: ['editor-role'] }),
    );

    cmaMocks.listRoles.mockResolvedValueOnce([
      { id: 'editor-role', name: 'Editor' },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await finishRoleDiscovery();

    expect(cmaMocks.listRoles).toHaveBeenCalledTimes(2);
    expect(combobox(ROLES_LABEL)).toBeEnabled();
    expect(chosenRoles()).toEqual(['Editor']);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('does not request or edit the complete role list without user-management permission', async () => {
    const { ctx, updatePluginParameters } = createCtx({
      canManageUsers: false,
      parameters: { ...PARAMETERS, allowedRoleIds: ['editor-role'] },
    });
    render(<ConfigScreen ctx={ctx} />);
    await finishRoleDiscovery();

    expect(cmaMocks.buildClient).not.toHaveBeenCalled();
    expect(cmaMocks.listRoles).not.toHaveBeenCalled();
    expect(combobox(ROLES_LABEL)).toBeDisabled();
    expect(
      screen.getByText(/Only users who can manage collaborators/i),
    ).toBeVisible();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Read-only mode' }));
    await clickSave('Access');
    expect(updatePluginParameters).toHaveBeenCalledWith(
      expect.objectContaining({ allowedRoleIds: ['editor-role'] }),
    );
  });

  it('disables every editable field for read-only roles', () => {
    const { ctx } = createCtx({
      canEditSchema: false,
      canManageUsers: false,
    });
    render(<ConfigScreen ctx={ctx} />);

    const notice = screen.getByText('You can only view these settings');
    expect(notice).toBeVisible();
    expect(notice.closest('.Callout')).toHaveTextContent(
      'Only roles that can edit the schema can change them.',
    );
    expect(
      screen.getByRole('radio', { name: /^OpenAI \(ChatGPT\)/ }),
    ).toBeDisabled();
    expect(
      screen.getByRole('radio', { name: /^Anthropic \(Claude\)/ }),
    ).toBeDisabled();
    expect(screen.getByLabelText('OpenAI API key*')).toBeDisabled();
    expect(combobox('OpenAI model*')).toBeDisabled();
    expect(combobox('Reasoning effort')).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Fast mode' })).toBeDisabled();
    // The instructions stay readable and copyable: read-only, not disabled
    const instructions = screen.getByRole('textbox', {
      name: 'Additional instructions',
    });
    expect(instructions).toHaveAttribute('readonly');
    expect(instructions).toBeEnabled();
    instructions.focus();
    expect(instructions).toHaveFocus();
    expect(
      screen.getByRole('checkbox', { name: 'Read-only mode' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('checkbox', { name: 'Show in record sidebars' }),
    ).toBeDisabled();
    expect(combobox(ROLES_LABEL)).toBeDisabled();
    expect(screen.queryAllByRole('button', { name: 'Save' })).toHaveLength(0);
  });

  it('saves only the values of its own group, and keeps the edits of the others', async () => {
    const { ctx, updatePluginParameters } = createCtx();
    render(<ConfigScreen ctx={ctx} />);
    await finishModelDiscovery();

    fireEvent.change(
      screen.getByRole('textbox', { name: 'Additional instructions' }),
      { target: { value: 'Use sentence case.' } },
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Read-only mode' }));
    // Each group with changes can save; a group without them says why not
    expect(saveButton('Agent behavior')).not.toHaveAttribute('aria-disabled');
    expect(saveButton('Access')).not.toHaveAttribute('aria-disabled');
    expect(saveButton('Model provider')).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    await clickSave('Access');

    expect(updatePluginParameters).toHaveBeenCalledOnce();
    expect(updatePluginParameters).toHaveBeenCalledWith(
      expect.objectContaining({
        readOnly: true,
        additionalInstructions: PARAMETERS.additionalInstructions,
      }),
    );
    // The instructions are still an unsaved edit
    expect(
      screen.getByRole('textbox', { name: 'Additional instructions' }),
    ).toHaveValue('Use sentence case.');
    expect(saveButton('Access')).toHaveAttribute('aria-disabled', 'true');
    expect(saveButton('Agent behavior')).not.toHaveAttribute('aria-disabled');

    // The next save starts from what the first one saved
    await clickSave('Agent behavior');
    expect(updatePluginParameters).toHaveBeenLastCalledWith(
      expect.objectContaining({
        readOnly: true,
        additionalInstructions: 'Use sentence case.',
      }),
    );
  });

  it('saves the first-run role selection with the first save of any group', async () => {
    const { ctx, updatePluginParameters } = createCtx({
      parameters: { ...PARAMETERS, allowedRoleIds: null },
    });
    render(<ConfigScreen ctx={ctx} />);
    await finishModelDiscovery();
    await finishRoleDiscovery();

    fireEvent.change(
      screen.getByRole('textbox', { name: 'Additional instructions' }),
      { target: { value: 'Be brief.' } },
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Read-only mode' }));
    await clickSave('Agent behavior');

    // The roles field shows every role as allowed: the first save keeps it
    // so, and leaves the other access edits unsaved
    expect(updatePluginParameters).toHaveBeenLastCalledWith(
      expect.objectContaining({
        additionalInstructions: 'Be brief.',
        allowedRoleIds: ['editor-role', 'reviewer-role'],
        readOnly: PARAMETERS.readOnly,
      }),
    );
    expect(chosenRoles()).toEqual(['Editor', 'Reviewer']);
    expect(
      screen.getByRole('checkbox', { name: 'Read-only mode' }),
    ).toBeChecked();
    expect(saveButton('Access')).not.toHaveAttribute('aria-disabled');

    // With the read-only edit undone, the access has nothing left to save
    fireEvent.click(screen.getByRole('checkbox', { name: 'Read-only mode' }));
    expect(saveButton('Access')).toHaveAttribute('aria-disabled', 'true');
  });

  it('takes settings saved elsewhere into the groups without local edits', () => {
    const { ctx } = createCtx();
    const { rerender } = render(<ConfigScreen ctx={ctx} />);

    fireEvent.change(
      screen.getByRole('textbox', { name: 'Additional instructions' }),
      { target: { value: 'A local edit.' } },
    );
    rerender(
      <ConfigScreen
        ctx={
          createCtx({
            parameters: {
              ...PARAMETERS,
              openAiApiKey: 'sk-external',
              additionalInstructions: 'An external edit.',
            },
          }).ctx
        }
      />,
    );

    expect(screen.getByLabelText('OpenAI API key*')).toHaveValue('sk-external');
    expect(
      screen.getByRole('textbox', { name: 'Additional instructions' }),
    ).toHaveValue('A local edit.');
  });
});
