/**
 * renderWithCanvas.tsx
 * --------------------
 * Test helpers for components that render inside the `Canvas` that main.tsx
 * puts around every frame hook. The components no longer render a Canvas of
 * their own, so a test gives them one, with the plugin's texts and a fake
 * `ctx` that has what the Canvas reads from the host.
 */
import {
  type RenderResult,
  render,
  screen,
  within,
} from '@testing-library/react';
import Canvas, { type BaseCtx } from 'datocms-react-ui/Canvas';
import type { ReactElement } from 'react';
import { vi } from 'vitest';
import { PLUGIN_TEXTS } from '../utils/texts';

/**
 * A fake hook `ctx`: what `Canvas` reads (tokens, color scheme, padding, the
 * user's locale, the site's internal domain), the host's toasts, confirm and
 * navigation as `vi.fn`s, and the frame resizer. `overrides` replace the
 * defaults key by key.
 *
 * @param overrides - The properties of the hook's ctx that the test needs.
 * @returns The ctx, typed as the hook's ctx.
 */
export function makeCtx<Ctx extends BaseCtx = BaseCtx>(
  overrides: Record<string, unknown> = {},
): Ctx {
  return {
    cssDesignTokens: {},
    colorScheme: 'light',
    bodyPadding: [0, 0, 0, 0],
    ui: { locale: 'en' },
    site: { attributes: { internal_domain: null } },
    notice: vi.fn(),
    alert: vi.fn(),
    customToast: vi.fn(),
    openConfirm: vi.fn(),
    navigateTo: vi.fn(),
    updateHeight: vi.fn(),
    startAutoResizer: vi.fn(),
    stopAutoResizer: vi.fn(),
    ...overrides,
  } as unknown as Ctx;
}

export type CanvasRenderResult = Omit<RenderResult, 'rerender'> & {
  /** Renders new content in the Canvas, with a new ctx when given. */
  rerender: (ui: ReactElement, nextCtx?: BaseCtx) => void;
};

/**
 * Renders `ui` inside a `Canvas` with `ctx`, as main.tsx does for a hook.
 *
 * @param ui - The component under test.
 * @param ctx - The hook's ctx (see `makeCtx`).
 * @returns The Testing Library result; `rerender` keeps the Canvas.
 */
export function renderWithCanvas(
  ui: ReactElement,
  ctx: BaseCtx = makeCtx(),
): CanvasRenderResult {
  const result = render(
    <Canvas ctx={ctx} texts={PLUGIN_TEXTS}>
      {ui}
    </Canvas>,
  );
  return {
    ...result,
    rerender: (nextUi, nextCtx = ctx) =>
      result.rerender(
        <Canvas ctx={nextCtx} texts={PLUGIN_TEXTS}>
          {nextUi}
        </Canvas>,
      ),
  };
}

/**
 * The remove button of one chip of a multiple `SelectInput`. Every chip's
 * button has the same name ("Remove"), so it is found from the chip's label:
 * the closest box around the label that holds exactly one of them.
 *
 * @param label - The text of the chip.
 * @returns The chip's remove button.
 */
export function getChipRemoveButton(label: string): HTMLElement {
  let node: HTMLElement | null = screen.getByText(label);
  while (node) {
    const buttons = within(node).queryAllByRole('button', { name: 'Remove' });
    if (buttons.length === 1) return buttons[0];
    if (buttons.length > 1) break;
    node = node.parentElement;
  }
  throw new Error(`No remove button for the chip "${label}"`);
}
