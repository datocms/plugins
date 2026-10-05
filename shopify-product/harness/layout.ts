import { FIELD_EXTENSION_INITIAL_HEIGHT } from '../src/constants';
import type { ModalWidth, ResolvedState, SurfaceKind } from './surface';

/**
 * Frame geometry, copied from the dashboard (design-language plugins.md
 * sections 4 and 5). A self-resizing frame is the host column plus
 * `bodyPadding` on each side: the host pulls the iframe outward by that much,
 * and `<Canvas>` pads it back in.
 */

export type StageBackground = 'surface' | 'raised';

export type WidthPreset = {
  label: string;
  /** Iframe width in px (column + 2 × body padding). */
  frameWidth: number;
};

type KindLayout = {
  label: string;
  bodyPadding: number;
  background: StageBackground;
  /** Content height the host reserves before the plugin measures itself. */
  initialHeight: number;
};

/** The host's frame height when a hook declares no `initialHeight`. */
export const HOST_DEFAULT_HEIGHT = 35;

export const KIND_LAYOUT: Record<SurfaceKind, KindLayout> = {
  config: {
    label: 'Config screen',
    bodyPadding: 30,
    background: 'surface',
    initialHeight: HOST_DEFAULT_HEIGHT,
  },
  fieldConfig: {
    label: 'Field config',
    bodyPadding: 10,
    background: 'raised',
    initialHeight: HOST_DEFAULT_HEIGHT,
  },
  field: {
    label: 'Field editor',
    bodyPadding: 10,
    background: 'surface',
    // What src/main.tsx declares on the manual field extension.
    initialHeight: FIELD_EXTENSION_INITIAL_HEIGHT,
  },
  modal: {
    label: 'Modal',
    bodyPadding: 20,
    background: 'raised',
    initialHeight: HOST_DEFAULT_HEIGHT,
  },
};

/** The modal body is inset 24px inside the panel. */
export const MODAL_BODY_INSET = 24;
export const MODAL_PANEL_WIDTHS = { s: 600, m: 700, l: 900, xl: 1010 };

/** Panel width for `ctx.openModal({ width })`, or null for `fullWidth`. */
export function modalPanelWidth(width: ModalWidth | undefined): number | null {
  if (width === 'fullWidth') {
    return null;
  }
  if (typeof width === 'number') {
    return width;
  }
  return MODAL_PANEL_WIDTHS[width ?? 's'];
}

/** Iframe width inside a modal panel: panel − 2 × 24 + 2 × 20. */
export function modalFrameWidth(panelWidth: number): number {
  return panelWidth - 2 * MODAL_BODY_INSET + 2 * KIND_LAYOUT.modal.bodyPadding;
}

function columnPreset(
  kind: SurfaceKind,
  label: string,
  column: number,
): WidthPreset {
  return { label, frameWidth: column + 2 * KIND_LAYOUT[kind].bodyPadding };
}

export const WIDTH_PRESETS: Record<SurfaceKind, WidthPreset[]> = {
  config: [columnPreset('config', '650 column', 650)],
  fieldConfig: [columnPreset('fieldConfig', '600 box', 600)],
  field: [
    columnPreset('field', '800 form', 800),
    columnPreset('field', '500 narrow', 500),
  ],
  modal: (['xl', 'l', 'm', 's'] as const).map((size) => ({
    label: `${size} ${MODAL_PANEL_WIDTHS[size]}`,
    frameWidth: modalFrameWidth(MODAL_PANEL_WIDTHS[size]),
  })),
};

/** The default iframe width for a surface state (`?width=` overrides it). */
export function defaultFrameWidth(
  kind: SurfaceKind,
  state: ResolvedState,
): number {
  if (kind === 'modal') {
    const panel = modalPanelWidth(state.modalWidth ?? 'xl');
    return modalFrameWidth(panel ?? MODAL_PANEL_WIDTHS.xl);
  }
  return WIDTH_PRESETS[kind][0].frameWidth;
}

/** `?width=` as a positive integer, or null. */
export function parseWidth(value: string | null): number | null {
  const width = Number.parseInt(value ?? '', 10);
  return Number.isFinite(width) && width > 0 ? width : null;
}
