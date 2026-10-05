import type {
  Modal,
  RenderConfigScreenCtx,
  RenderFieldExtensionCtx,
  RenderManualFieldExtensionConfigScreenCtx,
  RenderModalCtx,
} from 'datocms-plugin-sdk';
import type { ReactNode } from 'react';
import type { FieldType } from '../src/types';

/**
 * The surface contract. Every `harness/surfaces/*.tsx` file default-exports
 * one surface (wrap it in `defineSurface` for type inference); the registry
 * discovers them with `import.meta.glob`, so adding a surface never touches
 * shared harness code.
 */

/**
 * - `config`: `renderConfigScreen` (650px column, 30px body padding).
 * - `fieldConfig`: `renderManualFieldExtensionConfigScreen` (the bordered box
 *   in the field modal, 10px body padding).
 * - `field`: `renderFieldExtension` (800px form column, 10px body padding).
 * - `modal`: `renderModal` (20px body padding). Its `id` is the modal id that
 *   `ctx.openModal({ id })` opens, e.g. `shopifyPicker`.
 */
export type SurfaceKind = 'config' | 'fieldConfig' | 'field' | 'modal';

export const SURFACE_KINDS: readonly SurfaceKind[] = [
  'config',
  'fieldConfig',
  'field',
  'modal',
];

export type CtxByKind = {
  config: RenderConfigScreenCtx;
  fieldConfig: RenderManualFieldExtensionConfigScreenCtx;
  field: RenderFieldExtensionCtx;
  modal: RenderModalCtx;
};

export type ModalWidth = NonNullable<Modal['width']>;

/**
 * What a named state sets on the mock ctx and the host page. Every key is
 * optional; unset keys fall back to the kind's defaults (see mockCtx.ts).
 */
export type SurfaceState = {
  /** Shown under the harness toolbar. */
  description?: string;
  /** `plugin.attributes.parameters`. Default: v3 with the demo store on. */
  pluginParameters?: Record<string, unknown>;
  /** `field` and `fieldConfig`: the field type. Default `'json'`. */
  fieldType?: FieldType;
  /**
   * `field`: the appearance parameters (`ctx.parameters` and
   * `field.attributes.appearance.parameters`). `fieldConfig`: the initial
   * `ctx.parameters`. Default `{}` (a 1.x field).
   */
  fieldParameters?: Record<string, unknown>;
  /** `field`: the stored value at `ctx.fieldPath`. Default `null`. */
  value?: unknown;
  /** `field`: `ctx.disabled`. */
  disabled?: boolean;
  /** `field`: a localized field; the value lives under `formValues[apiKey][locale]`. */
  localized?: boolean;
  /** `field` and `fieldConfig`: the field's API key. Default `'shopify_product'`. */
  apiKey?: string;
  /** `field`: the label the host draws above the frame. Default `'Shopify product'`. */
  fieldLabel?: string;
  /** `fieldConfig`: fixed `ctx.errors`, merged over what `validate` returns. */
  errors?: Record<string, unknown>;
  /** `ctx.ui.locale`. Default `'en'`. */
  uiLocale?: string;
  /** `ctx.currentRole` can edit the schema. Default `true`. */
  canEditSchema?: boolean;
  /** `modal` shown on its own: `ctx.parameters`. Default `{}`. */
  modalParameters?: Record<string, unknown>;
  /** `modal` shown on its own: the width it was opened with. Default `'xl'`. */
  modalWidth?: ModalWidth;
  /** `modal` shown on its own: the host-drawn title bar, if any. */
  modalTitle?: string;
  /** Content height the host reserves before the first measurement. */
  initialHeight?: number;
  /** What the host paints behind the frame. Default per kind. */
  background?: 'surface' | 'raised';
};

/** A state as handed to `render`: the state's keys plus its name. */
export type ResolvedState = SurfaceState & { name: string };

/**
 * Builds a fresh mock ctx from the current mock state, the way the SDK hands
 * a new ctx object to every render. `overrides` are spread over it.
 */
export type CtxBuilder<K extends SurfaceKind> = (
  overrides?: Partial<CtxByKind[K]>,
) => CtxByKind[K];

export type HarnessSurface<K extends SurfaceKind> = {
  /** URL id (`?surface=`). For `modal` surfaces, the modal id it answers. */
  id: string;
  title: string;
  kind: K;
  description?: string;
  /** Named states (`?state=`), in picker order. The first is the default. */
  states?: Record<string, SurfaceState>;
  /**
   * `fieldConfig` only: computes `ctx.errors` from `ctx.parameters` on every
   * render, standing in for `validateManualFieldExtensionParameters`.
   */
  validate?: (parameters: Record<string, unknown>) => Record<string, unknown>;
  /** Renders the real entrypoint. Call `ctx()` once per render. */
  render: (ctx: CtxBuilder<K>, state: ResolvedState) => ReactNode;
};

export type AnySurface = { [K in SurfaceKind]: HarnessSurface<K> }[SurfaceKind];

/** Identity helper that infers `K` from `kind`, so `render` gets a typed ctx. */
export function defineSurface<K extends SurfaceKind>(
  surface: HarnessSurface<K>,
): HarnessSurface<K> {
  return surface;
}
