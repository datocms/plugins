import type { ConfirmOptions, RenderPageCtx, Toast } from 'datocms-plugin-sdk';
import { type Mock, vi } from 'vitest';

export type MockCtx = {
  ctx: RenderPageCtx;
  openConfirm: Mock<(options: ConfirmOptions) => Promise<unknown>>;
  notice: Mock<(message: string) => Promise<void>>;
  alert: Mock<(message: string) => Promise<void>>;
  customToast: Mock<(toast: Toast<unknown>) => Promise<unknown>>;
  navigateTo: Mock<(path: string) => Promise<void>>;
};

/**
 * The page ctx that the UI and `Canvas` read, with spies for every host
 * call. It imports nothing from the UI, so a test can render one component
 * inside `<Canvas ctx={createMockCtx().ctx}>` on its own.
 *
 * Like a real page ctx, it has no `startAutoResizer`: `Canvas` starts no
 * auto-resizer for it.
 */
export function createMockCtx(
  locale = 'en',
  { internalDomain = null }: { internalDomain?: string | null } = {},
): MockCtx {
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
    // Without an internal domain (the default), `Canvas` gives the links no
    // absolute `href`: a `to` goes through `navigateTo`.
    site: { attributes: { internal_domain: internalDomain } },
    openConfirm,
    notice,
    alert,
    customToast,
    navigateTo,
  } as unknown as RenderPageCtx;

  return { ctx, openConfirm, notice, alert, customToast, navigateTo };
}
