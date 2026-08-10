import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import type { FormEvent, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

type Option = {
  label: string;
  value: string;
};

vi.mock('datocms-react-ui', () => ({
  Canvas: ({ children }: { children: ReactNode }) => <>{children}</>,
  FieldGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Form: ({
    children,
    onSubmit,
  }: {
    children: ReactNode;
    onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  }) => <form onSubmit={onSubmit}>{children}</form>,
  Section: ({ children, title }: { children: ReactNode; title: ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  TextField: ({
    error,
    hint,
    id,
    label,
    name,
    onChange,
    placeholder,
    required,
    textInputProps,
    value,
  }: {
    error?: ReactNode;
    hint?: ReactNode;
    id: string;
    label: ReactNode;
    name: string;
    onChange: (value: string) => void;
    placeholder?: string;
    required?: boolean;
    textInputProps?: {
      'aria-required'?: boolean;
      disabled?: boolean;
      type?: string;
    };
    value: string;
  }) => (
    <div>
      <label htmlFor={id}>{label}</label>
      <input
        aria-required={textInputProps?.['aria-required'] || required}
        disabled={textInputProps?.disabled}
        id={id}
        name={name}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={textInputProps?.type}
        value={value}
      />
      {error && <span>{error}</span>}
      {hint && <div>{hint}</div>}
    </div>
  ),
  SelectField: ({
    error,
    hint,
    id,
    label,
    name,
    onChange,
    required,
    selectInputProps,
    value,
  }: {
    error?: ReactNode;
    hint?: ReactNode;
    id: string;
    label: ReactNode;
    name: string;
    onChange: (value: Option | readonly Option[] | null) => void;
    required?: boolean;
    selectInputProps?: {
      isDisabled?: boolean;
      isLoading?: boolean;
      isMulti?: boolean;
      options?: Option[];
      required?: boolean;
    };
    value?: Option | readonly Option[] | null;
  }) => {
    const selectedOptions = Array.isArray(value) ? value : value ? [value] : [];
    const availableOptions = selectInputProps?.options ?? [];
    const renderedOptions = [
      ...availableOptions,
      ...selectedOptions.filter(
        (selected) =>
          !availableOptions.some((option) => option.value === selected.value),
      ),
    ];

    return (
      <div>
        <label htmlFor={id}>{label}</label>
        <select
          aria-busy={selectInputProps?.isLoading}
          disabled={selectInputProps?.isDisabled}
          id={id}
          multiple={selectInputProps?.isMulti}
          name={name}
          onChange={(event) => {
            if (selectInputProps?.isMulti) {
              onChange(
                Array.from(event.currentTarget.selectedOptions).flatMap(
                  (selected) => {
                    const option = renderedOptions.find(
                      (candidate) => candidate.value === selected.value,
                    );
                    return option ? [option] : [];
                  },
                ),
              );
              return;
            }

            onChange(
              availableOptions.find(
                (option) => option.value === event.currentTarget.value,
              ) ?? null,
            );
          }}
          required={selectInputProps?.required || required}
          value={
            selectInputProps?.isMulti
              ? selectedOptions.map((option) => option.value)
              : (selectedOptions[0]?.value ?? '')
          }
        >
          {renderedOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {error && <span>{error}</span>}
        {hint && <div>{hint}</div>}
      </div>
    );
  },
  SwitchField: ({
    hint,
    id,
    label,
    onChange,
    switchInputProps,
    value,
  }: {
    hint?: ReactNode;
    id: string;
    label: ReactNode;
    onChange: (value: boolean) => void;
    switchInputProps?: { disabled?: boolean };
    value: boolean;
  }) => (
    <div>
      <label htmlFor={id}>
        {label}
        <input
          checked={value}
          disabled={switchInputProps?.disabled}
          id={id}
          onChange={(event) => onChange(event.target.checked)}
          type="checkbox"
        />
      </label>
      {hint && <span>{hint}</span>}
    </div>
  ),
  TextareaField: ({
    id,
    label,
    onChange,
    textareaInputProps,
    value,
  }: {
    id: string;
    label: ReactNode;
    onChange: (value: string) => void;
    textareaInputProps?: { disabled?: boolean };
    value: string;
  }) => (
    <label htmlFor={id}>
      {label}
      <textarea
        disabled={textareaInputProps?.disabled}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  ),
  Button: ({
    children,
    disabled,
    fullWidth,
    type = 'button',
  }: {
    children: ReactNode;
    disabled?: boolean;
    fullWidth?: boolean;
    type?: 'button' | 'submit';
  }) => (
    <button
      data-full-width={fullWidth ? 'true' : undefined}
      disabled={disabled}
      type={type}
    >
      {children}
    </button>
  ),
}));

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
  const notice = vi.fn().mockResolvedValue(undefined);
  const alert = vi.fn().mockResolvedValue(undefined);
  const ctx = {
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
    notice,
    alert,
  } as unknown as RenderConfigScreenCtx;

  return { alert, ctx, notice, updatePluginParameters };
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

  it('uses a native provider form and preserves the OpenAI default', async () => {
    const { ctx } = createCtx();
    render(<ConfigScreen ctx={ctx} />);
    await finishModelDiscovery();

    expect(screen.getByLabelText('Vendor')).toHaveValue('openai');
    expect(
      within(screen.getByLabelText('Vendor')).getByRole('option', {
        name: 'OpenAI (ChatGPT)',
      }),
    ).toBeVisible();
    expect(
      within(screen.getByLabelText('Vendor')).getByRole('option', {
        name: 'Anthropic (Claude)',
      }),
    ).toBeVisible();
    expect(screen.getByLabelText('OpenAI API key')).toBeRequired();
    expect(screen.getByLabelText('OpenAI API key')).toBeEnabled();
    expect(screen.getByLabelText('OpenAI model')).toBeRequired();
    expect(screen.getByLabelText('Fast mode')).toBeEnabled();
    expect(
      screen.getByText(/premium processing.*increase API costs/i),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Save settings' }),
    ).toHaveAttribute('data-full-width', 'true');
    expect(modelMocks.listProviderModels).toHaveBeenCalledWith(
      'openai',
      'sk-project',
      expect.any(AbortSignal),
    );
  });

  it('switches vendor fields without losing inactive OpenAI values', async () => {
    const { ctx } = createCtx();
    render(<ConfigScreen ctx={ctx} />);
    await finishModelDiscovery();

    fireEvent.change(screen.getByLabelText('Vendor'), {
      target: { value: 'anthropic' },
    });
    expect(screen.getByLabelText('Anthropic API key')).toHaveValue('');
    expect(screen.getByLabelText('Claude model')).toBeDisabled();

    modelMocks.listProviderModels.mockResolvedValueOnce([
      CLAUDE_OPUS,
      CLAUDE_SONNET,
    ]);
    fireEvent.change(screen.getByLabelText('Anthropic API key'), {
      target: { value: 'sk-ant-project' },
    });
    await finishModelDiscovery();

    expect(modelMocks.listProviderModels).toHaveBeenLastCalledWith(
      'anthropic',
      'sk-ant-project',
      expect.any(AbortSignal),
    );
    expect(screen.getByLabelText('Claude model')).toHaveValue(
      'claude-sonnet-5',
    );

    fireEvent.change(screen.getByLabelText('Vendor'), {
      target: { value: 'openai' },
    });
    expect(screen.getByLabelText('OpenAI API key')).toHaveValue('sk-project');
    expect(screen.getByLabelText('OpenAI model')).toHaveValue('gpt-5.6-terra');
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

    const effort = screen.getByLabelText('Reasoning effort');
    expect(screen.getByLabelText('Claude model')).toHaveValue(
      'claude-sonnet-5',
    );
    expect(effort).toHaveValue('high');
    expect(
      within(effort)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([
      'Low — faster responses',
      'High — deeper reasoning (Recommended)',
      'Max — maximum reasoning',
    ]);
    expect(within(effort).queryByRole('option', { name: /None/ })).toBeNull();
  });

  it('marks Medium as the recommended OpenAI balance', async () => {
    const { ctx } = createCtx();
    render(<ConfigScreen ctx={ctx} />);
    await finishModelDiscovery();

    expect(
      within(screen.getByLabelText('Reasoning effort')).getByRole('option', {
        name: 'Medium — balanced (Recommended)',
      }),
    ).toBeInTheDocument();
  });

  it('saves fast mode independently for OpenAI', async () => {
    const { ctx, updatePluginParameters } = createCtx();
    render(<ConfigScreen ctx={ctx} />);
    await finishModelDiscovery();

    fireEvent.click(screen.getByLabelText('Fast mode'));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await act(async () => {});

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

    fireEvent.change(screen.getByLabelText('Additional instructions'), {
      target: { value: 'Use sentence case.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await act(async () => {});

    expect(updatePluginParameters).toHaveBeenCalledOnce();
    expect(notice).toHaveBeenCalledWith('Dato Agent (Beta) settings saved');
    expect(
      screen.getByRole('button', { name: 'Save settings' }),
    ).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Saving…' })).toBeNull();
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

    expect(screen.getByLabelText('Fast mode')).toBeDisabled();
    expect(screen.getByText(/requires a supported Opus model/i)).toBeVisible();

    fireEvent.change(screen.getByLabelText('Claude model'), {
      target: { value: CLAUDE_OPUS.id },
    });
    expect(screen.getByLabelText('Fast mode')).toBeEnabled();
    fireEvent.click(screen.getByLabelText('Fast mode'));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await act(async () => {});

    expect(updatePluginParameters).toHaveBeenCalledWith(
      expect.objectContaining({
        anthropicFastMode: true,
        anthropicModel: CLAUDE_OPUS.id,
      }),
    );
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

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await act(async () => {});

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

    fireEvent.change(screen.getByLabelText('Claude model'), {
      target: { value: CLAUDE_SONNET.id },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await act(async () => {});

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
    expect(screen.getByText(/Temporary OpenAI error/)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await finishModelDiscovery();

    expect(modelMocks.listProviderModels).toHaveBeenCalledTimes(2);
    expect(screen.getByText('1 compatible model available.')).toBeVisible();
  });

  it('saves unrelated settings when provider discovery is unavailable', async () => {
    modelMocks.listProviderModels.mockRejectedValueOnce(
      new Error('Temporary OpenAI error'),
    );
    const { ctx, updatePluginParameters } = createCtx();
    render(<ConfigScreen ctx={ctx} />);

    await finishModelDiscovery();
    expect(screen.getByText(/Temporary OpenAI error/)).toBeVisible();

    fireEvent.change(screen.getByLabelText('Additional instructions'), {
      target: { value: 'Use the project editorial style.' },
    });
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await act(async () => {});

    expect(updatePluginParameters).toHaveBeenCalledWith(
      expect.objectContaining({
        additionalInstructions: 'Use the project editorial style.',
        model: PARAMETERS.model,
        openAiApiKey: PARAMETERS.openAiApiKey,
      }),
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
    expect(screen.getByLabelText('OpenAI API key')).toHaveValue('sk-external');

    fireEvent.change(screen.getByLabelText('OpenAI API key'), {
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

    expect(screen.getByLabelText('OpenAI API key')).toHaveValue(
      'sk-local-edit',
    );
  });

  it('validates only the selected provider inline', () => {
    const { alert, ctx, updatePluginParameters } = createCtx({
      parameters: {},
    });
    render(<ConfigScreen ctx={ctx} />);

    fireEvent.change(screen.getByLabelText('Vendor'), {
      target: { value: 'anthropic' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(screen.getByText('Anthropic API key is required.')).toBeVisible();
    expect(screen.queryByText('OpenAI API key is required.')).toBeNull();
    expect(updatePluginParameters).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });

  it('renders native permission fields in the required order', async () => {
    const { ctx } = createCtx();
    render(<ConfigScreen ctx={ctx} />);
    await finishRoleDiscovery();

    const section = screen
      .getByRole('heading', { name: 'Permissions' })
      .closest('section');
    expect(section).not.toBeNull();
    expect(
      Array.from(
        section?.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
          'input, select',
        ) ?? [],
      ).map((control) => control.id),
    ).toEqual(['read-only', 'enable-record-sidebar', 'allowed-role-ids']);
    expect(
      screen.getByText(
        'Project owners always have access. New roles must be added manually.',
      ),
    ).toBeVisible();
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

    const roles = screen.getByLabelText(
      'All roles that can use DatoAgent',
    ) as HTMLSelectElement;
    expect(
      Array.from(roles.selectedOptions).map((option) => option.value),
    ).toEqual(['editor-role', 'reviewer-role']);
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeEnabled();
    expect(cmaMocks.buildClient).toHaveBeenCalledWith({
      apiToken: 'current-user-token',
      environment: 'primary',
      baseUrl: 'https://site-api.example.com',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await act(async () => {});

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

    const roles = screen.getByLabelText(
      'All roles that can use DatoAgent',
    ) as HTMLSelectElement;
    expect(
      Array.from(roles.selectedOptions).map((option) => option.value),
    ).toEqual(['editor-role']);

    fireEvent.click(screen.getByLabelText('Read Only'));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await act(async () => {});

    expect(updatePluginParameters).toHaveBeenCalledWith(
      expect.objectContaining({ allowedRoleIds: ['editor-role'] }),
    );
  });

  it('supports explicitly clearing every collaborator role', async () => {
    const { ctx, updatePluginParameters } = createCtx();
    render(<ConfigScreen ctx={ctx} />);
    await finishRoleDiscovery();

    const roles = screen.getByLabelText(
      'All roles that can use DatoAgent',
    ) as HTMLSelectElement;
    for (const option of roles.options) {
      option.selected = false;
    }
    fireEvent.change(roles);
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await act(async () => {});

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

    expect(
      screen.getByRole('option', {
        name: 'Unavailable role (removed-role)',
      }),
    ).toHaveProperty('selected', true);

    fireEvent.click(screen.getByLabelText('Read Only'));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await act(async () => {});

    expect(updatePluginParameters).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedRoleIds: ['editor-role', 'removed-role'],
      }),
    );

    const roles = screen.getByLabelText(
      'All roles that can use DatoAgent',
    ) as HTMLSelectElement;
    for (const option of roles.options) {
      option.selected = option.value === 'editor-role';
    }
    fireEvent.change(roles);
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await act(async () => {});

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

    expect(screen.getByText(/Temporary CMA error/)).toBeVisible();
    expect(
      screen.getByLabelText('All roles that can use DatoAgent'),
    ).toBeDisabled();

    fireEvent.click(screen.getByLabelText('Read Only'));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await act(async () => {});
    expect(updatePluginParameters).toHaveBeenCalledWith(
      expect.objectContaining({ allowedRoleIds: ['editor-role'] }),
    );

    cmaMocks.listRoles.mockResolvedValueOnce([
      { id: 'editor-role', name: 'Editor' },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await finishRoleDiscovery();

    expect(cmaMocks.listRoles).toHaveBeenCalledTimes(2);
    expect(
      screen.getByLabelText('All roles that can use DatoAgent'),
    ).toBeEnabled();
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
    expect(
      screen.getByLabelText('All roles that can use DatoAgent'),
    ).toBeDisabled();
    expect(
      screen.getByText(/Only users who can manage collaborators/i),
    ).toBeVisible();

    fireEvent.click(screen.getByLabelText('Read Only'));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await act(async () => {});
    expect(updatePluginParameters).toHaveBeenCalledWith(
      expect.objectContaining({ allowedRoleIds: ['editor-role'] }),
    );
  });

  it('disables every editable provider field for read-only roles', () => {
    const { ctx } = createCtx({
      canEditSchema: false,
      canManageUsers: false,
    });
    render(<ConfigScreen ctx={ctx} />);

    expect(screen.getByLabelText('Vendor')).toBeDisabled();
    expect(screen.getByLabelText('OpenAI API key')).toBeDisabled();
    expect(screen.getByLabelText('Fast mode')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save settings' })).toBeNull();
  });
});
