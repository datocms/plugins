export type ValidGlobalParams = {
  paramsVersion: '2';
  defaultMaxRating: number;
  defaultStarsColor: string;
  autoApplyToFieldsWithApiKey: string;
};

export const defaultStarsColor = '#FFB400';

export type LegacyGlobalParams = {};

export type EmptyParams = {};

export type GlobalParams = ValidGlobalParams | LegacyGlobalParams | EmptyParams;

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
    defaultMaxRating: 5,
    defaultStarsColor,
    autoApplyToFieldsWithApiKey: '',
  };
}
