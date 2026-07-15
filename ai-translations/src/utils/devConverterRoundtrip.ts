/**
 * Debug-only converter round-trip probe (phase-0 E2E plan, spec §9.4 test 6).
 *
 * `ctx.formValuesToItem` and `ctx.itemToFormValues` only exist inside the live
 * plugin iframe, so the proof that they compose losslessly has to run in the
 * browser rather than in a unit test. This module exposes that proof as
 * `window.__aiTranslationsRoundtrip()`, registered on the sidebar panel
 * iframe's window only when `enableDebugging` is on; an E2E test drives it via
 * `frame.evaluate`.
 *
 * Known-legitimate normalizations are excluded from the diff rather than
 * papered over: `internalLocales` (a form-only key, not an item attribute)
 * and `undefined` ↔ `null` leaves (the SDK serializes `undefined` to `null`
 * on the way through — see `prepareItemPayload`).
 */
import type { RenderItemFormSidebarPanelCtx } from 'datocms-plugin-sdk';

/** Outcome of the round-trip probe: whether it was lossless, and the diffs found if not. */
export type RoundtripResult = { ok: boolean; diffs: string[] };

/** Keys present in `formValues` that are not item attributes and must not be diffed. */
const IGNORED_KEYS = new Set(['internalLocales']);

/** Diffs two same-length arrays element-by-element, recursing via {@link diffValues}. */
const diffArrays = (a: unknown[], b: unknown[], path: string, out: string[]): void => {
  if (a.length !== b.length) {
    out.push(`${path}: array length ${a.length} → ${b.length}`);
    return;
  }
  for (let i = 0; i < a.length; i += 1) {
    diffValues(a[i], b[i], `${path}[${i}]`, out);
  }
};

/** Diffs two plain objects key-by-key, skipping {@link IGNORED_KEYS} and recursing via {@link diffValues}. */
const diffObjects = (
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  path: string,
  out: string[],
): void => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (IGNORED_KEYS.has(k)) continue;
    diffValues(a[k], b[k], `${path}.${k}`, out);
  }
};

/**
 * Deep-compares two values, appending a human-readable entry to `out` for every
 * leaf that differs. `undefined` and `null` are treated as equivalent leaves,
 * and keys in {@link IGNORED_KEYS} are skipped entirely — both are legitimate
 * normalizations of the SDK's converters, not round-trip losses.
 *
 * @param a - The original value (or subtree).
 * @param b - The round-tripped value (or subtree) to compare against `a`.
 * @param path - JSON-path-like breadcrumb for the current position, used to
 * label any diff pushed to `out` (e.g. `$.title.en`).
 * @param out - Accumulator mutated in place with one entry per differing leaf.
 */
export const diffValues = (
  a: unknown,
  b: unknown,
  path: string,
  out: string[],
): void => {
  if (a === b) return;
  if ((a === undefined || a === null) && (b === undefined || b === null)) return;
  if (Array.isArray(a) && Array.isArray(b)) {
    diffArrays(a, b, path, out);
    return;
  }
  if (typeof a === 'object' && typeof b === 'object' && a && b) {
    diffObjects(a as Record<string, unknown>, b as Record<string, unknown>, path, out);
    return;
  }
  out.push(`${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
};

/**
 * Registers `window.__aiTranslationsRoundtrip`, a debug-only probe that runs
 * `ctx.formValues` through `formValuesToItem` → `itemToFormValues` and
 * deep-compares the result against the original `formValues`. Call once from
 * the sidebar render when `pluginParams.enableDebugging` is true; reassigning
 * the window property is idempotent, so calling it again (e.g. on every
 * render) is harmless.
 *
 * @param ctx - The sidebar panel ctx supplying the converters and the live
 * `formValues` to probe.
 */
export const registerConverterRoundtrip = (
  ctx: RenderItemFormSidebarPanelCtx,
): void => {
  (window as unknown as Record<string, unknown>).__aiTranslationsRoundtrip =
    async (): Promise<RoundtripResult> => {
      const item = await ctx.formValuesToItem(ctx.formValues, false);
      if (!item) return { ok: false, diffs: ['formValuesToItem returned undefined'] };
      const back = await ctx.itemToFormValues(item);
      const diffs: string[] = [];
      diffValues(ctx.formValues, back, '$', diffs);
      return { ok: diffs.length === 0, diffs };
    };
};
