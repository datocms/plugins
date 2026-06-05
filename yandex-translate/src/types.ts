export type FirstInstallationParameters = Record<string, never>;

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

function isObjectRecord(params: unknown): params is Record<string, unknown> {
  return Boolean(params) && typeof params === 'object';
}

export function isValidParameters(params: unknown): params is ValidParameters {
  return (
    isObjectRecord(params) &&
    typeof params.yandexApiKey === 'string' &&
    params.yandexApiKey.length > 0 &&
    params.parametersVersion === '2' &&
    Array.isArray(params.autoApplyRules)
  );
}

export function normalizeParams(params: unknown): ValidParameters {
  if (isValidParameters(params)) {
    return params;
  }

  return {
    yandexApiKey:
      isObjectRecord(params) && typeof params.yandexApiKey === 'string'
        ? params.yandexApiKey
        : '',
    parametersVersion: '2',
    autoApplyRules: [],
  };
}
