// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ConfigScreen from './ConfigScreen';

function context(
  overrides: Record<string, unknown> = {},
): RenderConfigScreenCtx {
  return {
    mode: 'renderConfigScreen',
    plugin: { id: 'plugin-id' },
    environment: 'main',
    isEnvironmentPrimary: true,
    cssDesignTokens: {},
    colorScheme: 'light',
    bodyPadding: [0, 0, 0, 0],
    ui: { locale: 'en' },
    site: { attributes: { internal_domain: null } },
    notice: vi.fn(),
    alert: vi.fn(),
    customToast: vi.fn(),
    navigateTo: vi.fn(),
    openConfirm: vi.fn(),
    updateHeight: vi.fn(),
    startAutoResizer: vi.fn(),
    stopAutoResizer: vi.fn(),
    ...overrides,
  } as unknown as RenderConfigScreenCtx;
}

afterEach(cleanup);

describe('ConfigScreen', () => {
  it('links to the page of the tool', () => {
    const ctx = context();
    render(<ConfigScreen ctx={ctx} />);
    fireEvent.click(screen.getByText('Unused assets'));
    expect(ctx.navigateTo).toHaveBeenCalledWith(
      '/configuration/p/plugin-id/pages/unused-assets',
    );
  });

  it('keeps the environment in the link', () => {
    const ctx = context({
      environment: 'staging',
      isEnvironmentPrimary: false,
    });
    render(<ConfigScreen ctx={ctx} />);
    fireEvent.click(screen.getByText('Unused assets'));
    expect(ctx.navigateTo).toHaveBeenCalledWith(
      '/environments/staging/configuration/p/plugin-id/pages/unused-assets',
    );
  });
});
