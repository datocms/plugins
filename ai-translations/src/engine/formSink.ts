/**
 * Form sink (spec §2.3 items 2, 6, 7): the record (sidebar) path's terminal
 * write step. Consumes the `writes` array `payloadToFormWrites` (formAdapter.ts)
 * produces and stages each `(fieldPath, value)` into the OPEN Formik form via
 * `ctx.setFieldValue` — the user still reviews and Saves; there is no CMA
 * write here, and so nothing to verify against a persisted response.
 *
 * Deliberately bypasses both `verifyPersistedWrite` (§2.3-7 — no persisted
 * write exists yet) and the locale-sync fallback (a bulk/CMA-path concern):
 * importing either here would wire the sidebar into machinery it has no use
 * for.
 */

/** Yields one animation frame so a burst of writes doesn't jank the form (§2.3-6). */
const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Reads `apiKey.locale` back out of `ctx.formValues` after a write, to catch
 * the SDK silently dropping a value (§6.3 form-side verification).
 *
 * `fieldPath` is always exactly two dot-segments (enforced by
 * `payloadToFormWrites`), so this is a fixed two-level traversal rather than
 * a general dot-path walker.
 */
const readBack = (
  formValues: Record<string, unknown>,
  fieldPath: string,
): unknown => {
  const [apiKey, locale] = fieldPath.split('.');
  const fieldValue = formValues[apiKey] as Record<string, unknown> | undefined;
  return fieldValue?.[locale];
};

/**
 * Stages `writes` into the live Formik form, one rAF-yielded write at a time.
 *
 * Checks `isCancelled()` immediately before each `setFieldValue` call (§2.3-2):
 * the instant it flips true, every remaining write — including one whose
 * translation only just finished — is discarded rather than staged, so a
 * cancelled run never sneaks a late value into the form. Each written value is
 * read back from `ctx.formValues` to catch a silent drop.
 *
 * @param args.writes - `{ fieldPath, locale, value }` triples from
 *   `payloadToFormWrites`, `fieldPath` always `` `${apiKey}.${locale}` ``.
 * @param args.ctx - The SDK's `setFieldValue` plus the live `formValues` snapshot.
 * @param args.isCancelled - Reads a `useRef` mirror of the cancel flag; the
 *   sink only calls it, it does not own the ref (AGENTS.md: never React state
 *   for a value a running loop must observe live).
 * @returns Counts of written vs. discarded writes, plus any `fieldPath` whose
 *   post-write read-back came back missing.
 */
export const writeToForm = async (args: {
  writes: Array<{ fieldPath: string; locale: string; value: unknown }>;
  ctx: {
    setFieldValue(path: string, value: unknown): Promise<void>;
    formValues: Record<string, unknown>;
  };
  isCancelled(): boolean;
}): Promise<{ written: number; discarded: number; verifiedMissing: string[] }> => {
  const { writes, ctx, isCancelled } = args;
  const verifiedMissing: string[] = [];
  let written = 0;

  for (let i = 0; i < writes.length; i += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: each write must yield a frame before the next — that's the point of the rAF pacing.
    await nextFrame();

    // Checked immediately before the write itself (§2.3-2's discard point):
    // a value whose translation only just completed after cancel is never
    // written, even though it already yielded a frame above.
    if (isCancelled()) break;

    const { fieldPath, value } = writes[i];
    await ctx.setFieldValue(fieldPath, value);
    written += 1;

    if (readBack(ctx.formValues, fieldPath) === undefined) {
      verifiedMissing.push(fieldPath);
    }
  }

  return { written, discarded: writes.length - written, verifiedMissing };
};
