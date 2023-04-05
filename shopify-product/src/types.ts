export type FirstInstallationParameters = {};

export type ValidConfig = {
  shopifyDomain: string;
  storefrontAccessToken: string;
  autoApplyToFieldsWithApiKey: string;
  paramsVersion: '2';
};

export type LegacyConfig =
  | {
      shopifyDomain: string;
      storefrontAccessToken: string;
    }
  | FirstInstallationParameters;

export type Config = ValidConfig | LegacyConfig | FirstInstallationParameters;

export function isValidConfig(params: Config): params is ValidConfig {
  return params && 'paramsVersion' in params && params.paramsVersion === '2';
}

export function normalizeConfig(params: Config): ValidConfig {
  if (isValidConfig(params)) {
    return params;
  }

  return {
    paramsVersion: '2',
    storefrontAccessToken:
      'storefrontAccessToken' in params
        ? params.storefrontAccessToken
        : '078bc5caa0ddebfa89cccb4a1baa1f5c',
    shopifyDomain: 'shopifyDomain' in params ? params.shopifyDomain : 'graphql',
    autoApplyToFieldsWithApiKey: '',
  };
}
