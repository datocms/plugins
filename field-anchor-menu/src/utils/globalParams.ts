export type ValidGlobalParams = {
  paramsVersion: '2';
  startOpen: boolean;
  minFieldsToShow: number;
};

export type FirstInstallationParams = {};

export type GlobalParams = ValidGlobalParams | FirstInstallationParams;

export function isValidGlobalParams(
  params: GlobalParams,
): params is ValidGlobalParams {
  return params && 'paramsVersion' in params && params.paramsVersion === '2';
}

export function normalizeGlobalParams(params: GlobalParams): ValidGlobalParams {
  if (isValidGlobalParams(params)) {
    return params;
  }

  return {
    paramsVersion: '2',
    startOpen: true,
    minFieldsToShow: 5,
  };
}
