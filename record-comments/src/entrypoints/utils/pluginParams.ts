/**
 * Plugin Parameters Type and Validation
 *
 * Provides type-safe access to plugin configuration without using
 * unsafe type assertions like `as PluginParameters`.
 */

/**
 * Override settings for a single user's display.
 * Allows customizing how a user appears across the plugin.
 */
export type UserOverride = {
  /** Custom display name to use instead of the user's actual name */
  nameOverride?: string;
  /** DatoCMS upload ID for custom avatar image */
  uploadId?: string;
};

/**
 * Map of user overrides keyed by composite user identifier.
 * Key format: "{type}:{id}" where type is 'user', 'sso', 'org', or 'account'
 * Examples: "user:123", "sso:456", "org:789", "account:101"
 */
export type UserOverrides = {
  [compositeKey: string]: UserOverride;
};

/**
 * Type definition for plugin parameters.
 * All properties are optional as they may not be set initially.
 */
export type PluginParameters = {
  /** CDA token for GraphQL subscriptions (real-time updates) */
  cdaToken?: string;
  /** Whether migration from legacy format has been completed */
  migrationCompleted?: boolean;
  /** Whether real-time updates are enabled (defaults to true) */
  realTimeUpdatesEnabled?: boolean;
  /** User profile customizations (display names and avatars) */
  userOverrides?: UserOverrides;
};

/**
 * Default values for plugin parameters.
 * Note: userOverrides defaults to undefined (not empty object) to save space.
 */
const PLUGIN_PARAMS_DEFAULTS = {
  cdaToken: '',
  migrationCompleted: false,
  realTimeUpdatesEnabled: true,
  userOverrides: undefined as UserOverrides | undefined,
};

/**
 * Validates a single UserOverride object.
 * Returns undefined if the input is not a valid override object.
 */
function parseUserOverride(value: unknown): UserOverride | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  const override: UserOverride = {};

  if (typeof raw.nameOverride === 'string' && raw.nameOverride.length > 0) {
    override.nameOverride = raw.nameOverride;
  }

  if (typeof raw.uploadId === 'string' && raw.uploadId.length > 0) {
    override.uploadId = raw.uploadId;
  }

  // Only return the override if it has at least one valid property
  return Object.keys(override).length > 0 ? override : undefined;
}

/**
 * Validates the UserOverrides map.
 * Returns undefined if no valid overrides exist.
 */
function parseUserOverrides(value: unknown): UserOverrides | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  const overrides: UserOverrides = {};
  let hasValidOverride = false;

  for (const key of Object.keys(raw)) {
    // Validate key format: should be "{type}:{id}"
    if (!key.includes(':')) {
      continue;
    }

    const override = parseUserOverride(raw[key]);
    if (override) {
      overrides[key] = override;
      hasValidOverride = true;
    }
  }

  return hasValidOverride ? overrides : undefined;
}

/**
 * Parses and validates plugin parameters from unknown input.
 *
 * This replaces unsafe type assertions like `as PluginParameters`.
 * Returns validated parameters with defaults applied for missing values.
 *
 * @param params - The raw parameters object from ctx.plugin.attributes.parameters
 * @returns Validated plugin parameters with defaults applied
 */
export function parsePluginParams(params: unknown): PluginParameters {
  // If params is null/undefined or not an object, return defaults
  if (!params || typeof params !== 'object') {
    return { ...PLUGIN_PARAMS_DEFAULTS };
  }

  const rawParams = params as Record<string, unknown>;

  return {
    cdaToken:
      typeof rawParams.cdaToken === 'string'
        ? rawParams.cdaToken
        : PLUGIN_PARAMS_DEFAULTS.cdaToken,
    migrationCompleted:
      typeof rawParams.migrationCompleted === 'boolean'
        ? rawParams.migrationCompleted
        : PLUGIN_PARAMS_DEFAULTS.migrationCompleted,
    realTimeUpdatesEnabled:
      typeof rawParams.realTimeUpdatesEnabled === 'boolean'
        ? rawParams.realTimeUpdatesEnabled
        : PLUGIN_PARAMS_DEFAULTS.realTimeUpdatesEnabled,
    userOverrides: parseUserOverrides(rawParams.userOverrides),
  };
}

/**
 * Checks if a CDA token is configured.
 */
export function hasCdaToken(params: PluginParameters): boolean {
  return typeof params.cdaToken === 'string' && params.cdaToken.length > 0;
}
