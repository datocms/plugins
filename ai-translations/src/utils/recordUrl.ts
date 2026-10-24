/**
 * recordUrl.ts
 * Small, side-effect-free helper for linking to a record's editing screen in
 * the DatoCMS admin from inside a plugin iframe. It builds the CMS path: the
 * kit's links (`to`) route it through the host, and the Canvas turns it into
 * the absolute URL on the project's internal domain for a new tab.
 */

/** Inputs required to build a record editor path. */
export interface RecordEditorPathParams {
  /**
   * The project's admin domain, from `ctx.site.attributes.internal_domain`.
   * The path doesn't use it, but without it the Canvas can't give the link
   * its absolute URL, so a new tab would open the wrong page.
   */
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
 * Builds the CMS path of a record's editing screen, for a kit link's `to`.
 *
 * Sandbox environments are addressed under `/environments/<env>`; the primary
 * environment omits that segment. Returns `undefined` when there isn't enough
 * information to build a link that works, so callers can leave it out.
 *
 * @param params - Admin domain, environment context, and record identifiers.
 * @returns The editor path, or undefined when the link can't be built.
 */
export function buildRecordEditorPath({
  internalDomain,
  environment,
  isEnvironmentPrimary,
  itemTypeId,
  recordId,
}: RecordEditorPathParams): string | undefined {
  if (!internalDomain || !itemTypeId || !recordId) return undefined;
  const environmentPrefix =
    environment && !isEnvironmentPrimary ? `/environments/${environment}` : '';
  return `${environmentPrefix}/editor/item_types/${itemTypeId}/items/${recordId}/edit`;
}
