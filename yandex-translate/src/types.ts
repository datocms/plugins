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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

export function isValidParameters(
  params: unknown,
): params is ValidParameters {
  return (
    isRecord(params) &&
    params &&
    'yandexApiKey' in params &&
    !!params.yandexApiKey &&
    'parametersVersion' in params &&
    params.parametersVersion === '2'
  );
}

export function normalizeParams(params: unknown): ValidParameters {
  if (isValidParameters(params)) {
    return params;
  }

  return {
    yandexApiKey:
      isRecord(params) && typeof params.yandexApiKey === 'string'
        ? params.yandexApiKey
        : '',
    parametersVersion: '2',
    autoApplyRules: [],
  };
}
