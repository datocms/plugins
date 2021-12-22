export type FirstInstallationParameters = {};

export type ValidConfig = {
  baseEndpoint: string;
  clientId: string;
  autoApplyToFieldsWithApiKey: string;
  paramsVersion: '2';
};

export type LegacyConfig =
  | {
      baseEndpoint: string;
      clientId: string;
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
    baseEndpoint: 'baseEndpoint' in params ? params.baseEndpoint : '',
    clientId: 'clientId' in params ? params.clientId : '',
    autoApplyToFieldsWithApiKey: '',
  };
}
