/**
 * types.ts
 * --------
 * Shared types for the projectwide field-fate tree (spec
 * `docs/superpowers/specs/2026-07-15-field-fate-tree-design.md`).
 */

/**
 * UI-layer fate vocabulary. `skip` maps to the engine's `exclude` token at the
 * storage layer (`apiKeysToBeExcludedFromThisPlugin`); `copy` maps to
 * `fieldsToCopyFromSource`; `translate` is the sparse default (in neither list).
 */
export type FieldFate = 'translate' | 'copy' | 'skip';

/** The two sparse token arrays a fate is derived from and written back to. */
export interface FateLists {
  /** `pluginParams.apiKeysToBeExcludedFromThisPlugin` — Skip. */
  excludedTokens: string[];
  /** `pluginParams.fieldsToCopyFromSource` — Copy. */
  copyTokens: string[];
}

/** Per-model tally of resolved fates, always summing to the field count. */
export interface FateSummary {
  translate: number;
  copy: number;
  skip: number;
}

/**
 * One node in the fate tree. A leaf field has no `children`; a block-container
 * field carries its (recursively built) sub-field nodes and its own row is a
 * computed rollup, never stored (spec §3.2).
 */
export interface FateFieldNode {
  id: string;
  apiKey: string;
  label: string;
  required: boolean;
  fieldType: string;
  /** Present when this field embeds blocks — its translatable sub-field nodes. */
  children?: FateFieldNode[];
}

/** A model (or top-level item type) and its translatable field tree. */
export interface FateModelNode {
  id: string;
  name: string;
  fields: FateFieldNode[];
  /** Fields the translatable filter removed — shown as a per-model footer. */
  nonTranslatable: { label: string }[];
}
