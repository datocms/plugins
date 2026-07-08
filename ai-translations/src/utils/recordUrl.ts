/**
 * recordUrl.ts
 * Small, side-effect-free helper for linking to a record's editing screen in
 * the DatoCMS admin from inside a plugin iframe (whose own origin is not the
 * admin origin, so links must be built from `ctx.site` + environment info).
 */

/** Inputs required to build a record editor URL. */
export interface RecordEditorUrlParams {
  /** The project's admin domain, from `ctx.site.attributes.internal_domain`. */
  internalDomain: string | null | undefined;
  /** Current environment slug (`ctx.environment`). */
  environment?: string;
  /** Whether the current environment is primary (`ctx.isEnvironmentPrimary`). */
  isEnvironmentPrimary?: boolean;
  /** Item type (model) id the record belongs to. */
  itemTypeId: string | undefined;
  /** Record id. */
  recordId: string;
}

/**
 * Builds an absolute URL to a record's editing screen in the DatoCMS admin.
 *
 * Sandbox environments are addressed under `/environments/<env>`; the primary
 * environment omits that segment. Returns `undefined` when there isn't enough
 * information to build a valid link, so callers can render plain text instead.
 *
 * @param params - Admin domain, environment context, and record identifiers.
 * @returns The absolute editor URL, or undefined when it cannot be built.
 */
export function buildRecordEditorUrl({
  internalDomain,
  environment,
  isEnvironmentPrimary,
  itemTypeId,
  recordId,
}: RecordEditorUrlParams): string | undefined {
  if (!internalDomain || !itemTypeId || !recordId) return undefined;
  const environmentPrefix =
    environment && !isEnvironmentPrimary ? `/environments/${environment}` : '';
  return `https://${internalDomain}${environmentPrefix}/editor/item_types/${itemTypeId}/items/${recordId}/edit`;
}
