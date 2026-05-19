export type ValidGlobalParams = {
  paramsVersion: '2';
  defaultMaxRating: number;
  defaultStarsColor: string;
  autoApplyToFieldsWithApiKey: string;
};

export const defaultStarsColor = '#FFB400';

export type LegacyGlobalParams = Record<string, never>;

export type EmptyParams = Record<string, never>;

export type GlobalParams =
  | ValidGlobalParams
  | LegacyGlobalParams
  | EmptyParams
  | Record<string, unknown>
  | null
  | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isValidGlobalParams(
  params: unknown,
): params is ValidGlobalParams {
  return isRecord(params) && params.paramsVersion === '2';
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
