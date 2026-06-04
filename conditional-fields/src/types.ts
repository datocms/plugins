export type EmptyParameters = Record<string, never>;

export type BooleanTriggerParameters = {
  targetFieldsApiKey: string[];
  invert: boolean;
};

export type ScalarTriggerParameters = {
  targetFieldsApiKey: string[];
  showWhenValues: string[];
};

export type ValidManualExtensionParameters =
  | BooleanTriggerParameters
  | ScalarTriggerParameters;

export type LegacyManualExtensionParameters =
  | {
      slaveFields: string;
      invert: boolean;
    }
  | EmptyParameters;

export type ManualExtensionParameters =
  | ValidManualExtensionParameters
  | LegacyManualExtensionParameters
  | EmptyParameters;

export type ValidGlobalParameters = {
  parametersVersion: '2';
};

export type GlobalParameters = ValidGlobalParameters | EmptyParameters;

export function isBooleanTriggerParameters(
  params: Record<string, unknown>,
): params is BooleanTriggerParameters {
  return (
    params &&
    'targetFieldsApiKey' in params &&
    Array.isArray(params.targetFieldsApiKey) &&
    !('showWhenValues' in params)
  );
}

export function isScalarTriggerParameters(
  params: Record<string, unknown>,
): params is ScalarTriggerParameters {
  return (
    params &&
    'targetFieldsApiKey' in params &&
    Array.isArray(params.targetFieldsApiKey) &&
    'showWhenValues' in params &&
    Array.isArray(params.showWhenValues)
  );
}

export function isValidParameters(
  params: Record<string, unknown>,
): params is ValidManualExtensionParameters {
  return isBooleanTriggerParameters(params) || isScalarTriggerParameters(params);
}

export function isValidGlobalParameters(
  params: GlobalParameters,
): params is ValidGlobalParameters {
  return (
    params && 'parametersVersion' in params && params.parametersVersion === '2'
  );
}
