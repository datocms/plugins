import { type RenderResult, render } from '@testing-library/react';
import Canvas, { type BaseCtx } from 'datocms-react-ui/Canvas';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { TEXTS } from '../texts';

/** The titles that the fake host gives to records, by the ID of the record */
const fakeRecordTitles = new Map<string, string>();

/**
 * Sets the titles that the fake host presents for records (what
 * `ctx.loadItemPresentationInfo` resolves, and thus what a RecordRow shows).
 * A record without a title here does not exist for the host.
 */
export function setFakeRecordTitles(titles: Record<string, string>) {
  fakeRecordTitles.clear();
  for (const [id, title] of Object.entries(titles)) {
    fakeRecordTitles.set(id, title);
  }
}

async function fakeLoadItemPresentationInfo(
  items: Array<string | { id: string }>,
) {
  return items.map((item) => {
    const id = typeof item === 'string' ? item : item.id;
    const title = fakeRecordTitles.get(id);
    if (title === undefined) return null;
    return {
      id,
      title,
      image: null,
      itemTypeId: 'model',
      status: 'published' as const,
      currentVersionValid: true,
      publishedVersionValid: true,
      editPath: null,
    };
  });
}

/** The fake host has no asset: a preview shows the blank file icon */
async function fakeLoadUploads(ids: string[]) {
  return ids.map(() => null);
}

type FakeCtxOverrides = Record<string, unknown> & {
  ui?: Record<string, unknown>;
  site?: Record<string, unknown> & { attributes?: Record<string, unknown> };
};

/**
 * A `ctx` with what the Canvas of datocms-react-ui reads from the host: the
 * tokens, the color scheme, the body padding, the locale, the site, and the
 * methods that show notifications, ask questions, navigate and size the
 * frame (all `vi.fn`), and the loaders of records and assets (see
 * setFakeRecordTitles). `ui` and `site` merge with the overrides; every other
 * override replaces the default. Give the hook's ctx type to get it back.
 */
export function fakeCtx<T = BaseCtx>(overrides: FakeCtxOverrides = {}): T {
  const { ui, site, ...rest } = overrides;

  return {
    mode: 'renderInspector',
    cssDesignTokens: {},
    colorScheme: 'light',
    bodyPadding: [0, 0, 0, 0],
    notice: vi.fn(async () => undefined),
    alert: vi.fn(async () => undefined),
    customToast: vi.fn(async () => null),
    openConfirm: vi.fn(async () => null),
    navigateTo: vi.fn(async () => undefined),
    startAutoResizer: vi.fn(),
    stopAutoResizer: vi.fn(),
    updateHeight: vi.fn(),
    itemTypes: {},
    loadItemPresentationInfo: vi.fn(fakeLoadItemPresentationInfo),
    loadUploads: vi.fn(fakeLoadUploads),
    ...rest,
    ui: { locale: 'en', ...ui },
    site: {
      id: 'site-id',
      ...site,
      attributes: {
        name: 'Test project',
        internal_domain: null,
        ...site?.attributes,
      },
    },
  } as T;
}

type CanvasRenderResult = Omit<RenderResult, 'rerender'> & {
  ctx: BaseCtx;
  /** Renders new content in the Canvas, with the same ctx or a new one */
  rerender: (node: ReactNode, ctx?: BaseCtx) => void;
};

/**
 * Renders a component of the plugin inside the real Canvas, with the texts
 * of the plugin, as a hook renders it in the frame.
 */
export function renderInCanvas(
  node: ReactNode,
  ctx: BaseCtx = fakeCtx(),
): CanvasRenderResult {
  const inCanvas = (child: ReactNode, canvasCtx: BaseCtx) => (
    <Canvas ctx={canvasCtx} texts={TEXTS}>
      {child}
    </Canvas>
  );
  const result = render(inCanvas(node, ctx));

  return {
    ...result,
    ctx,
    rerender: (nextNode, nextCtx = ctx) =>
      result.rerender(inCanvas(nextNode, nextCtx)),
  };
}
