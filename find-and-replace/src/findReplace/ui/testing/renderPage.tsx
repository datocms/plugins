import { render } from '@testing-library/react';
import type { ConfirmOptions, RenderPageCtx, Toast } from 'datocms-plugin-sdk';
import { StrictMode } from 'react';
import { type Mock, vi } from 'vitest';
import type { BootView, FindReplaceSnapshot } from '../../contract';
import { FindReplaceApp } from '../FindReplaceApp';
import { createFakeController, type FakeController } from './fakeController';
import { type StateId, stateBoot } from './fixtures';

export type MockCtx = {
  ctx: RenderPageCtx;
  openConfirm: Mock<(options: ConfirmOptions) => Promise<unknown>>;
  notice: Mock<(message: string) => Promise<void>>;
  alert: Mock<(message: string) => Promise<void>>;
  customToast: Mock<(toast: Toast<unknown>) => Promise<unknown>>;
  navigateTo: Mock<(path: string) => Promise<void>>;
};

/** The page ctx the UI reads (SPEC §9), with spies for every host call. */
export function createMockCtx(locale = 'en'): MockCtx {
  const openConfirm = vi.fn(
    async (_options: ConfirmOptions) => false as unknown,
  );
  const notice = vi.fn(async (_message: string) => {});
  const alert = vi.fn(async (_message: string) => {});
  const customToast = vi.fn(async (_toast: Toast<unknown>) => null as unknown);
  const navigateTo = vi.fn(async (_path: string) => {});
  const ctx = {
    mode: 'renderPage',
    bodyPadding: [0, 0, 0, 0],
    theme: {},
    cssDesignTokens: {},
    colorScheme: 'light',
    ui: { locale },
    openConfirm,
    notice,
    alert,
    customToast,
    navigateTo,
  } as unknown as RenderPageCtx;

  return { ctx, openConfirm, notice, alert, customToast, navigateTo };
}

type RenderOptions = {
  mock?: MockCtx;
  strict?: boolean;
};

export function renderBoot(boot: BootView, options: RenderOptions = {}) {
  const mock = options.mock ?? createMockCtx();
  const element = <FindReplaceApp ctx={mock.ctx} boot={boot} />;
  const view = render(
    options.strict ? <StrictMode>{element}</StrictMode> : element,
  );
  return { ...view, mock };
}

/** Renders the page for a state fixture (S1–S23) with a fake controller. */
export function renderState(id: StateId, options: RenderOptions = {}) {
  const retry = vi.fn();
  const { boot, controller } = stateBoot(id, retry);
  return { ...renderBoot(boot, options), controller, retry };
}

/** Renders the ready page for any snapshot. */
export function renderSnapshot(
  snapshot: FindReplaceSnapshot,
  options: RenderOptions = {},
): ReturnType<typeof renderBoot> & { controller: FakeController } {
  const controller = createFakeController(snapshot);
  return {
    ...renderBoot({ status: 'ready', controller }, options),
    controller,
  };
}
