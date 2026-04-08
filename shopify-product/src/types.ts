/**
 * Plugin configuration types and runtime validation.
 *
 * The DatoCMS SDK types plugin parameters as `Record<string, unknown>` since
 * they're user-defined JSON stored in the database. These types describe the
 * known shapes we expect, and the runtime functions validate/migrate from the
 * SDK's untyped parameters into our typed `ValidConfig`.
 *
 * Config history:
 * - v1 (LegacyConfig): only shopifyDomain + storefrontAccessToken
 * - v2 (ValidConfig): adds paramsVersion discriminant + autoApplyToFieldsWithApiKey
 * - FirstInstallationParameters: empty object before the user configures anything
 */

/** Empty parameters before the user has saved any configuration. */
export type FirstInstallationParameters = Record<string, never>;

/** Current config schema (v2). */
export type ValidConfig = {
  shopifyDomain: string;
  storefrontAccessToken: string;
  autoApplyToFieldsWithApiKey: string;
  paramsVersion: '2';
};

/** Pre-v2 config that lacks the version discriminant and auto-apply field. */
export type LegacyConfig = {
  shopifyDomain: string;
  storefrontAccessToken: string;
};

/** Union of every config shape the plugin may encounter in the wild. */
export type Config = ValidConfig | LegacyConfig | FirstInstallationParameters;

/**
 * Runtime type guard that checks whether untyped SDK parameters are already a
 * fully valid v2 config. Used in `onBoot` to skip migration when unnecessary.
 */
export function isValidConfig(
  params: Record<string, unknown>,
): params is ValidConfig {
  return (
    params != null &&
    typeof params === 'object' &&
    params.paramsVersion === '2' &&
    typeof params.shopifyDomain === 'string' &&
    typeof params.storefrontAccessToken === 'string' &&
    typeof params.autoApplyToFieldsWithApiKey === 'string'
  );
}

/**
 * Checks whether a valid config has the required fields actually filled in.
 * A config can be structurally valid but still incomplete if the user hasn't
 * entered their Shopify credentials yet.
 */
export function isConfigComplete(config: ValidConfig): boolean {
  return (
    config.shopifyDomain.length > 0 && config.storefrontAccessToken.length > 0
  );
}

/**
 * Validates and migrates untyped SDK parameters into a `ValidConfig`.
 *
 * Handles three cases:
 * 1. Already a valid v2 config — returned as-is.
 * 2. Legacy v1 config — carries over shopifyDomain/storefrontAccessToken,
 *    fills in new fields with defaults.
 * 3. Empty/unknown shape (fresh install or corrupted data) — returns a
 *    blank config with all string fields defaulting to `''`.
 */
export function parseAndNormalizeConfig(
  raw: Record<string, unknown>,
): ValidConfig {
  if (isValidConfig(raw)) {
    return raw;
  }

  return {
    paramsVersion: '2',
    storefrontAccessToken:
      typeof raw.storefrontAccessToken === 'string'
        ? raw.storefrontAccessToken
        : '',
    shopifyDomain:
      typeof raw.shopifyDomain === 'string' ? raw.shopifyDomain : '',
    autoApplyToFieldsWithApiKey:
      typeof raw.autoApplyToFieldsWithApiKey === 'string'
        ? raw.autoApplyToFieldsWithApiKey
        : '',
  };
}
