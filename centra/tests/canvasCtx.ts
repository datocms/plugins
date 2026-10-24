import { vi } from 'vitest';

/**
 * The fields of a ctx that the kit's Canvas and the SDK auto-resizer read:
 * the tokens, the color scheme, the body padding, the locale, the internal
 * domain of the links, the host's notifications and questions, and the frame
 * sizing methods.
 *
 * Each test spreads it into its own ctx, adds what the hook under test needs
 * and overrides what it asserts (for example `alert` or `openConfirm`), then
 * casts the result to the hook's ctx type.
 */
export function canvasCtx() {
  return {
    bodyPadding: [0, 0, 0, 0],
    cssDesignTokens: {},
    colorScheme: 'light',
    theme: {},
    ui: { locale: 'en' },
    site: { attributes: { internal_domain: null } },
    notice: vi.fn(async () => undefined),
    alert: vi.fn(async () => undefined),
    customToast: vi.fn(async () => undefined),
    openConfirm: vi.fn(async (): Promise<unknown> => null),
    navigateTo: vi.fn(async () => undefined),
    startAutoResizer: vi.fn(),
    stopAutoResizer: vi.fn(),
    updateHeight: vi.fn(),
    setHeight: vi.fn(),
    isAutoResizerActive: () => false,
  };
}
