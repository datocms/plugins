import type { BaseCtx } from 'datocms-react-ui/Canvas';
import Canvas from 'datocms-react-ui/Canvas';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { TEXTS } from '@/texts';
import { render } from './react';

/**
 * A ctx with what the kit's Canvas reads from the host (tokens, color scheme,
 * padding, locale, internal domain, the notifications, the router and the
 * auto-resizer), plus the plugin fields most screens read. Pass the hook's own
 * fields as overrides.
 */
export function createCanvasCtx<T = BaseCtx>(
  overrides: Record<string, unknown> = {},
): T {
  return {
    cssDesignTokens: {},
    colorScheme: 'light',
    bodyPadding: [0, 0, 0, 0],
    ui: { locale: 'en' },
    site: {
      id: 'site-1',
      attributes: { internal_domain: 'acme.admin.datocms.com' },
    },
    environment: 'main',
    isEnvironmentPrimary: true,
    plugin: { id: 'plugin-1', attributes: { parameters: {} } },
    notice: vi.fn().mockResolvedValue(undefined),
    alert: vi.fn().mockResolvedValue(undefined),
    customToast: vi.fn().mockResolvedValue(undefined),
    navigateTo: vi.fn().mockResolvedValue(undefined),
    openConfirm: vi.fn().mockResolvedValue(false),
    updateHeight: vi.fn(),
    startAutoResizer: vi.fn(),
    stopAutoResizer: vi.fn(),
    ...overrides,
  } as T;
}

/**
 * Renders a node inside the kit's Canvas, with the texts of the plugin, as
 * the plugin entry does: every kit component needs one around it.
 */
export function renderInCanvas(node: ReactNode, ctx: unknown) {
  const canvasCtx = ctx as BaseCtx;
  const view = render(
    <Canvas ctx={canvasCtx} texts={TEXTS}>
      {node}
    </Canvas>,
  );

  return {
    ...view,
    rerender(nextNode: ReactNode, nextCtx: unknown = canvasCtx) {
      view.rerender(
        <Canvas ctx={nextCtx as BaseCtx} texts={TEXTS}>
          {nextNode}
        </Canvas>,
      );
    },
  };
}
