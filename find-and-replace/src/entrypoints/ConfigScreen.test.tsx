import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadModels: vi.fn(),
  loadRoles: vi.fn(),
}));

vi.mock('../utils/cma', () => ({
  buildCmaClient: () => ({}),
}));

vi.mock('../utils/schema', () => ({
  loadModels: mocks.loadModels,
  loadRoles: mocks.loadRoles,
}));

import ConfigScreen from './ConfigScreen';

type ContextOptions = {
  parameters?: Record<string, unknown>;
  canEditSchema?: boolean;
  token?: string;
};

function createContext({
  parameters = {},
  canEditSchema = true,
  token = 'token',
}: ContextOptions = {}) {
  const updatePluginParameters = vi.fn().mockResolvedValue(undefined);
  const notice = vi.fn();
  const alert = vi.fn();
  const ctx = {
    mode: 'renderConfigScreen',
    plugin: { attributes: { parameters } },
    currentUserAccessToken: token || undefined,
    environment: 'main',
    cmaBaseUrl: 'https://site-api.datocms.com',
    currentRole: {
      meta: { final_permissions: { can_edit_schema: canEditSchema } },
    },
    site: { attributes: { internal_domain: null } },
    ui: { locale: 'en' },
    colorScheme: 'light',
    bodyPadding: [0, 0, 0, 0],
    theme: {},
    cssDesignTokens: {},
    startAutoResizer: vi.fn(),
    stopAutoResizer: vi.fn(),
    updatePluginParameters,
    notice,
    alert,
    openConfirm: vi.fn(),
    customToast: vi.fn(),
    navigateTo: vi.fn(),
  } as unknown as RenderConfigScreenCtx;

  return { ctx, updatePluginParameters, notice, alert };
}

function saveButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Save' });
}

describe('ConfigScreen restrictions', () => {
  beforeEach(() => {
    mocks.loadModels.mockResolvedValue([
      {
        id: 'article',
        name: 'Article',
        apiKey: 'article',
        workflowId: null,
      },
    ]);
    mocks.loadRoles.mockResolvedValue([{ id: 'editor', name: 'Editor' }]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('reveals each selector only after its restriction is on', async () => {
    const user = userEvent.setup();
    const { ctx, updatePluginParameters } = createContext();
    render(<ConfigScreen ctx={ctx} />);

    expect(
      screen.queryByRole('combobox', { name: 'Roles' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('combobox', { name: 'Models' }),
    ).not.toBeInTheDocument();
    // Nothing changed yet: Save tells why it is unavailable.
    expect(saveButton()).toHaveAttribute('aria-disabled', 'true');
    await user.hover(saveButton());
    expect(
      await screen.findByText('There are no changes to save.'),
    ).toBeInTheDocument();
    await user.unhover(saveButton());
    // The tooltip fades out before it leaves the page.
    await waitFor(() =>
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument(),
    );

    // Each restriction is a pair of radios, starting on "every".
    expect(
      screen.getByRole('radio', { name: 'Every role that can edit records' }),
    ).toBeChecked();
    expect(
      screen.getByRole('radio', { name: 'Every model the role can edit' }),
    ).toBeChecked();
    expect(
      screen.getByRole('radiogroup', { name: 'Who can use Find and replace' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('radiogroup', { name: 'Models it searches' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Only some roles' }));

    expect(screen.getByRole('combobox', { name: 'Roles' })).toBeInTheDocument();
    // The error waits until the select was used: Save says why meanwhile.
    expect(
      screen.queryByText('Select at least one role.'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('combobox', { name: 'Models' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Roles' }));
    await user.keyboard('{Escape}');
    expect(screen.getByText('Select at least one role.')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Only some models' }));

    expect(
      screen.getByRole('combobox', { name: 'Models' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Select at least one model.'),
    ).not.toBeInTheDocument();

    // An empty restriction blocks Save.
    expect(saveButton()).toHaveAttribute('aria-disabled', 'true');
    await user.click(saveButton());
    expect(updatePluginParameters).not.toHaveBeenCalled();
  });

  it('keeps legacy selections when a restriction is switched off', async () => {
    const user = userEvent.setup();
    const { ctx, updatePluginParameters, notice } = createContext({
      parameters: {
        allowedRoleIds: ['editor'],
        allowedModelIds: ['article'],
      },
    });
    render(<ConfigScreen ctx={ctx} />);

    await waitFor(() => expect(screen.getByText('Editor')).toBeInTheDocument());
    expect(screen.getByRole('combobox', { name: 'Roles' })).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: 'Models' }),
    ).toBeInTheDocument();

    expect(
      screen.getByRole('radio', { name: 'Only some roles' }),
    ).toBeChecked();
    await user.click(
      screen.getByRole('radio', { name: 'Every role that can edit records' }),
    );
    expect(
      screen.queryByRole('combobox', { name: 'Roles' }),
    ).not.toBeInTheDocument();

    await user.click(saveButton());

    expect(updatePluginParameters).toHaveBeenCalledWith({
      restrictToRoles: false,
      allowedRoleIds: ['editor'],
      restrictToModels: true,
      allowedModelIds: ['article'],
    });
    await waitFor(() => expect(notice).toHaveBeenCalledWith('Settings saved'));
  });

  it('alerts when the save fails', async () => {
    const user = userEvent.setup();
    const { ctx, updatePluginParameters, notice, alert } = createContext({
      parameters: { restrictToModels: true, allowedModelIds: ['article'] },
    });
    updatePluginParameters.mockRejectedValueOnce(new Error('offline'));
    render(<ConfigScreen ctx={ctx} />);

    await user.click(
      screen.getByRole('radio', { name: 'Every model the role can edit' }),
    );
    await user.click(saveButton());

    expect(updatePluginParameters).toHaveBeenCalledWith({
      restrictToRoles: false,
      allowedRoleIds: [],
      restrictToModels: false,
      allowedModelIds: ['article'],
    });

    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        "Couldn't save the settings. Try again.",
      ),
    );
    expect(notice).not.toHaveBeenCalled();
  });

  it('shows the load error and the saved ids that no option has', () => {
    const { ctx } = createContext({
      token: '',
      parameters: { restrictToRoles: true, allowedRoleIds: ['deleted-role'] },
    });
    render(<ConfigScreen ctx={ctx} />);

    expect(
      screen.getByText("Couldn't load the roles and models"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The plugin needs access to your API token. Grant it in the plugin's permissions, then reload the page.",
      ),
    ).toBeInTheDocument();
    // The options couldn't load: the saved id says it is unknown, and it
    // stays, as nothing could be picked again.
    const chip = screen.getByText('Unknown role (deleted-role)');
    expect(chip.closest('[aria-disabled="true"]')).not.toBeNull();
    expect(mocks.loadRoles).not.toHaveBeenCalled();
  });

  it('names the saved ids that the loaded options no longer have', async () => {
    const { ctx } = createContext({
      parameters: {
        restrictToRoles: true,
        allowedRoleIds: ['editor', 'role_freelancer_2019'],
        restrictToModels: true,
        allowedModelIds: ['83521'],
      },
    });
    render(<ConfigScreen ctx={ctx} />);

    expect(
      await screen.findByText('Deleted role (role_freelancer_2019)'),
    ).toBeInTheDocument();
    expect(screen.getByText('Editor')).toBeInTheDocument();
    expect(screen.getByText('Deleted model (83521)')).toBeInTheDocument();
  });

  it('tells a role that cannot edit the schema why nothing changes, with no Save', () => {
    const { ctx } = createContext({ canEditSchema: false });
    render(<ConfigScreen ctx={ctx} />);

    expect(
      screen.getByText("Your role can't change these settings."),
    ).toBeInTheDocument();
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toBeDisabled();
    }
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(
      screen.queryByRole('button', { name: 'Save' }),
    ).not.toBeInTheDocument();
  });
});
