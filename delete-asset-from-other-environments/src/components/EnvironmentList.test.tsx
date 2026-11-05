// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { RenderUploadSidebarPanelCtx } from 'datocms-plugin-sdk';
import Canvas from 'datocms-react-ui/Canvas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Environment } from '../utils/assetEnvironmentOperations';
import { texts } from './AssetDeletionSidebar';
import { EnvironmentList } from './EnvironmentList';

function environment(index: number): Environment {
  return {
    id: `environment-${index}`,
    type: 'environment',
    meta: {
      status: 'ready',
      read_only_mode: false,
      created_at: '2026-01-01T00:00:00.000Z',
      last_data_change_at: '2026-01-01T00:00:00.000Z',
      primary: index === 0,
      forked_from: null,
    },
  };
}

function fixtures(count: number) {
  return Array.from({ length: count }, (_, index) => environment(index));
}

const ctx = {
  cssDesignTokens: {},
  colorScheme: 'light',
  bodyPadding: [0, 0, 0, 0],
  ui: { locale: 'en' },
  site: {
    id: 'synthetic-site',
    attributes: { internal_domain: 'synthetic.admin.datocms.com' },
  },
  navigateTo: vi.fn(),
  notice: vi.fn(),
  alert: vi.fn(),
  customToast: vi.fn(),
  openConfirm: vi.fn(),
} as unknown as RenderUploadSidebarPanelCtx;

function list(count: number) {
  return (
    <Canvas ctx={ctx} noAutoResizer texts={texts}>
      <EnvironmentList
        environments={fixtures(count)}
        uploadId="upload-00009999"
      />
    </Canvas>
  );
}

afterEach(cleanup);

describe('environment list rendering', () => {
  it('links each environment to its copy of the asset and marks the primary one', () => {
    render(list(3));

    expect(screen.getAllByRole('link')).toHaveLength(3);
    expect(
      screen.getByRole('link', { name: /^environment-0/ }).getAttribute('href'),
    ).toBe('https://synthetic.admin.datocms.com/media/assets/upload-00009999');
    expect(screen.getByText('Primary')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: /^environment-2/ }).getAttribute('href'),
    ).toBe(
      'https://synthetic.admin.datocms.com/environments/environment-2/media/assets/upload-00009999',
    );
    expect(screen.queryByRole('button', { name: /^Show / })).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: /^environment-2/ }));
    expect(ctx.navigateTo).toHaveBeenCalledWith(
      '/environments/environment-2/media/assets/upload-00009999',
    );
  });

  it('shows 100 environments at a time and keeps every one reachable', () => {
    const view = render(list(150));

    expect(screen.getAllByRole('link')).toHaveLength(100);
    fireEvent.click(
      screen.getByRole('button', { name: 'Show 50 more environments' }),
    );
    expect(screen.getAllByRole('link')).toHaveLength(150);
    expect(screen.queryByRole('button', { name: /^Show / })).toBeNull();

    view.rerender(list(3));
    expect(screen.getAllByRole('link')).toHaveLength(3);
  });
});
