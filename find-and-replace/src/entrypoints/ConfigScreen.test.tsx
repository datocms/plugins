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

function createContext(parameters: Record<string, unknown> = {}) {
  const updatePluginParameters = vi.fn().mockResolvedValue(undefined);
  const notice = vi.fn();
  const ctx = {
    plugin: { attributes: { parameters } },
    currentUserAccessToken: 'token',
    environment: 'main',
    currentRole: {
      meta: { final_permissions: { can_edit_schema: true } },
    },
    bodyPadding: [0, 0, 0, 0],
    theme: {},
    cssDesignTokens: {},
    startAutoResizer: vi.fn(),
    stopAutoResizer: vi.fn(),
    updatePluginParameters,
    notice,
    alert: vi.fn(),
  } as unknown as RenderConfigScreenCtx;

  return { ctx, updatePluginParameters, notice };
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

  it('reveals each selector only after its restriction is enabled', async () => {
    const user = userEvent.setup();
    const { ctx } = createContext();
    render(<ConfigScreen ctx={ctx} />);

    expect(
      screen.queryByText('Roles allowed to bulk update'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('Models allowed for bulk updates'),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('switch', {
        name: 'Allow only certain roles to bulk update',
      }),
    );

    expect(
      screen.getByText('Roles allowed to bulk update'),
    ).toBeInTheDocument();
    expect(screen.getByText('Select at least one role.')).toBeInTheDocument();

    await user.click(
      screen.getByRole('switch', {
        name: 'Allow only certain models to be bulk updated',
      }),
    );

    expect(
      screen.getByText('Models allowed for bulk updates'),
    ).toBeInTheDocument();
    expect(screen.getByText('Select at least one model.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Save settings' }),
    ).toBeDisabled();
  });

  it('retains legacy selections when a restriction is switched off', async () => {
    const user = userEvent.setup();
    const { ctx, updatePluginParameters, notice } = createContext({
      allowedRoleIds: ['editor'],
      allowedModelIds: ['article'],
    });
    render(<ConfigScreen ctx={ctx} />);

    await waitFor(() =>
      expect(
        screen.getByText('Roles allowed to bulk update'),
      ).toBeInTheDocument(),
    );

    await user.click(
      screen.getByRole('switch', {
        name: 'Allow only certain roles to bulk update',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(updatePluginParameters).toHaveBeenCalledWith({
      restrictToRoles: false,
      allowedRoleIds: ['editor'],
      restrictToModels: true,
      allowedModelIds: ['article'],
    });
    expect(notice).toHaveBeenCalledWith('Settings successfully saved!');
  });
});
