export type ValidFieldType = 'json' | 'string';

export type AutoApplyRule = {
  fieldTypes: ValidFieldType[];
  apiKeyRegexp: string;
};

export type ValidConfig = {
  autoApplyRules: AutoApplyRule[];
  paramsVersion: '2';
};

export type Config = {} | ValidConfig;

export function isValidParams(params: Config): params is ValidConfig {
  return (
    params &&
    'autoApplyRules' in params &&
    'paramsVersion' in params &&
    params.paramsVersion === '2'
  );
}

export function normalizeParams(params: Config): ValidConfig {
  if (isValidParams(params)) {
    return params;
  }

  return {
    autoApplyRules: [],
    paramsVersion: '2',
  };
}
