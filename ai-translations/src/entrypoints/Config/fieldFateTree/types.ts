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
