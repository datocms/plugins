export type ValidGlobalParams = {
  paramsVersion: '2';
  startOpen: boolean;
  minFieldsToShow: number;
};

export type FirstInstallationParams = Record<string, never>;

export type GlobalParams = ValidGlobalParams | FirstInstallationParams;

function isRecord(params: unknown): params is Record<string, unknown> {
  return typeof params === 'object' && params !== null;
}

export function isValidGlobalParams(
  params: unknown,
): params is ValidGlobalParams {
  return (
    isRecord(params) &&
    params.paramsVersion === '2' &&
    typeof params.startOpen === 'boolean' &&
    typeof params.minFieldsToShow === 'number'
  );
}

export function normalizeGlobalParams(params: unknown): ValidGlobalParams {
  if (isValidGlobalParams(params)) {
    return params;
  }

  return {
    paramsVersion: '2',
    startOpen: true,
    minFieldsToShow: 5,
  };
}
