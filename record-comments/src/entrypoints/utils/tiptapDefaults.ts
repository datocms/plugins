/**
 * TipTap Mention Attribute Defaults
 *
 * ================================================================================
 * SINGLE SOURCE OF TRUTH FOR TIPTAP BOOLEAN DEFAULTS
 * ================================================================================
 *
 * TipTap has non-obvious behavior where attributes matching their default value
 * are stored as `undefined` (or `null`) rather than the actual default value.
 * This means when reading mention attributes back from TipTap, we must apply
 * default values manually.
 *
 * WHY THIS FILE EXISTS:
 * - The pattern `attrs.localized ?? false` was duplicated in 3+ places
 * - If defaults change, all locations must be updated (error-prone)
 * - This file provides a single source of truth for these defaults
 *
 * USAGE:
 * ```typescript
 * import { TIPTAP_MENTION_DEFAULTS, applyFieldMentionDefaults } from './tiptapDefaults';
 *
 * // Option 1: Use helper function
 * const localized = applyFieldMentionDefaults.localized(attrs.localized);
 *
 * // Option 2: Use constant directly
 * const localized = attrs.localized ?? TIPTAP_MENTION_DEFAULTS.field.localized;
 * ```
 *
 * ================================================================================
 */

/**
 * Default values for TipTap mention attributes.
 *
 * These match the default values in the TipTap extension configurations.
 * When TipTap stores attributes, it omits values that match defaults,
 * so we need to re-apply them when reading.
 */
export const TIPTAP_MENTION_DEFAULTS = {
  field: {
    /** Whether the field is localized. Defaults to false. */
    localized: false as const,
  },
  model: {
    /** Whether the model is a block model. Defaults to false. */
    isBlockModel: false as const,
  },
} as const;

/**
 * Helper functions to apply defaults when reading field mention attributes.
 * Use these instead of inline `?? false` to ensure consistency.
 */
export const applyFieldMentionDefaults = {
  localized: (value: boolean | undefined | null): boolean =>
    value ?? TIPTAP_MENTION_DEFAULTS.field.localized,
};

/**
 * Helper functions to apply defaults when reading model mention attributes.
 * Use these instead of inline `?? false` to ensure consistency.
 */
export const applyModelMentionDefaults = {
  isBlockModel: (value: boolean | undefined | null): boolean =>
    value ?? TIPTAP_MENTION_DEFAULTS.model.isBlockModel,
};
