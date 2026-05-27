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
 * - v2 (ValidConfig): adds paramsVersion discriminant,
 *   autoApplyToFieldsWithApiKey, and useDemoStore
 * - FirstInstallationParameters: empty object before the user configures anything
 */

/** Empty parameters before the user has saved any configuration. */
export type FirstInstallationParameters = Record<string, never>;

/**
 * Public demo credentials for a dedicated Shopify Headless storefront.
 *
 * This is intentionally a public Storefront API access token, not a private
 * token or an Admin API token. Shopify public Storefront tokens are designed
 * for browser and mobile contexts, and are sent with the
 * `X-Shopify-Storefront-Access-Token` header by client-side code.
 *
 * The token belongs to a DatoCMS demo store that contains mock data only.
 * Shopify shares Headless Storefront API permissions across storefront tokens
 * for the same store, so this token can inherit read scopes beyond product
 * listings. That is acceptable only because the store is a disposable demo
 * store and must not contain real customer, checkout, or catalog data.
 *
 * All unauthenticated write operations are disabled for this demo token, so
 * visitors can browse demo products without modifying customer, checkout, or
 * other store data.
 *
 * If the demo store ever receives non-demo data, or if write scopes are enabled
 * again, rotate or remove this token before publishing another release.
 */
export const DEMO_SHOPIFY_CONFIG = {
  shopifyDomain: 'datocms-demo',
  storefrontAccessToken: '6f39fb123179b7d636d84d833d3d3adf',
} satisfies Pick<ValidConfig, 'shopifyDomain' | 'storefrontAccessToken'>;

/** Current config schema (v2). */
export type ValidConfig = {
  shopifyDomain: string;
  storefrontAccessToken: string;
  autoApplyToFieldsWithApiKey: string;
  useDemoStore: boolean;
  paramsVersion: '2';
};

/** Pre-v2 config that lacks one or more current config fields. */
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
    typeof params.autoApplyToFieldsWithApiKey === 'string' &&
    typeof params.useDemoStore === 'boolean'
  );
}

/**
 * Checks whether a valid config has the required fields actually filled in.
 * A config can be structurally valid but still incomplete if the user hasn't
 * entered their Shopify credentials yet.
 */
export function isConfigComplete(config: ValidConfig): boolean {
  return (
    config.useDemoStore ||
    (config.shopifyDomain.length > 0 && config.storefrontAccessToken.length > 0)
  );
}

/**
 * Validates and migrates untyped SDK parameters into a `ValidConfig`.
 *
 * Handles three cases:
 * 1. Already a valid v2 config — returned as-is.
 * 2. Legacy config — carries over shopifyDomain/storefrontAccessToken,
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
    useDemoStore:
      typeof raw.useDemoStore === 'boolean' ? raw.useDemoStore : false,
  };
}

export function getShopifyClientConfig(
  config: ValidConfig,
): Pick<ValidConfig, 'shopifyDomain' | 'storefrontAccessToken'> {
  return config.useDemoStore ? DEMO_SHOPIFY_CONFIG : config;
}
