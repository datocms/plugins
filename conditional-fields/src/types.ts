export type EmptyParameters = {};

export type ValidManualExtensionParameters = {
  targetFieldsApiKey: string[];
  invert: boolean;
};

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

export function isValidParameters(
  params: ManualExtensionParameters,
): params is ValidManualExtensionParameters {
  return (
    params &&
    'targetFieldsApiKey' in params &&
    Array.isArray(params.targetFieldsApiKey)
  );
}

export function isValidGlobalParameters(
  params: GlobalParameters,
): params is ValidGlobalParameters {
  return (
    params && 'parametersVersion' in params && params.parametersVersion === '2'
  );
}
