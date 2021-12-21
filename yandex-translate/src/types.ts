export type FirstInstallationParameters = {};

export type ValidFieldType = 'string' | 'text';

export type AutoApplyRule = {
  fieldTypes: ValidFieldType[];
  apiKeyRegexp: string;
};

export type ValidParameters = {
  yandexApiKey: string;
  autoApplyRules: AutoApplyRule[];
  parametersVersion: '2';
};

export type LegacyParameters =
  | {
      yandexApiKey: string;
      developmentMode: boolean;
    }
  | FirstInstallationParameters;

export type ConfigParameters =
  | ValidParameters
  | LegacyParameters
  | FirstInstallationParameters;

export function isValidParameters(
  params: ConfigParameters,
): params is ValidParameters {
  return (
    params &&
    'yandexApiKey' in params &&
    !!params.yandexApiKey &&
    'parametersVersion' in params &&
    params.parametersVersion === '2'
  );
}

export function normalizeParams(params: ConfigParameters): ValidParameters {
  if (isValidParameters(params)) {
    return params;
  }

  return {
    yandexApiKey:
      'yandexApiKey' in params
        ? params.yandexApiKey
        : '',
    parametersVersion: '2',
    autoApplyRules: [],
  };
}
