import {
  buildPluginSettingsPath,
  openModelPage,
  openUsersPage,
} from '@utils/navigationHelpers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const openSpy = vi.fn();

describe('navigation helpers', () => {
  beforeEach(() => {
    openSpy.mockReset();
    vi.stubGlobal('window', { open: openSpy });
  });

  it('does not open user pages when the internal domain is missing', () => {
    openUsersPage(
      {
        site: { attributes: { internal_domain: null } },
        environment: 'main',
        isEnvironmentPrimary: true,
      },
      'user',
    );

    expect(openSpy).not.toHaveBeenCalled();
  });

  it('does not open model pages when the internal domain is missing', () => {
    openModelPage(
      {
        site: { attributes: { internal_domain: null } },
        environment: 'main',
        isEnvironmentPrimary: true,
      },
      'model-1',
      false,
    );

    expect(openSpy).not.toHaveBeenCalled();
  });

  it('builds the plugin settings path with the environment prefix', () => {
    expect(
      buildPluginSettingsPath({
        environment: 'main',
        isEnvironmentPrimary: true,
        plugin: { id: 'plugin-1' },
      }),
    ).toBe('/configuration/plugins/plugin-1/edit');
    expect(
      buildPluginSettingsPath({
        environment: 'sandbox',
        isEnvironmentPrimary: false,
        plugin: { id: 'plugin-1' },
      }),
    ).toBe('/environments/sandbox/configuration/plugins/plugin-1/edit');
  });
});
