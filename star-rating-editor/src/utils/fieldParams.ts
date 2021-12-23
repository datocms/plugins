import { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import { normalizeGlobalParams, ValidGlobalParams } from './globalParams';

export type ValidFieldParams = {
  paramsVersion: '2';
  maxRating: number | null;
  starsColor: string | null;
};

export type LegacyFieldParams = {
  maxRating: number;
  starsColor: {
    red: number;
    blue: number;
    green: number;
  };
};

export type FieldParams = ValidFieldParams | LegacyFieldParams | {};

export function isValidFieldParams(
  params: FieldParams,
): params is ValidFieldParams {
  return params && 'paramsVersion' in params && params.paramsVersion === '2';
}

function rgbToHex({ red, blue, green }: LegacyFieldParams['starsColor']) {
  return (
    '#' + ((1 << 24) + (red << 16) + (green << 8) + blue).toString(16).slice(1).toUpperCase()
  );
}

export function normalizeFieldParams(
  params: FieldParams,
  globalParams: ValidGlobalParams,
): ValidFieldParams {
  if (isValidFieldParams(params)) {
    return params;
  }

  return {
    paramsVersion: '2',
    maxRating:
      !('maxRating' in params) ||
      globalParams.defaultMaxRating === params.maxRating
        ? null
        : params.maxRating,
    starsColor:
      !('starsColor' in params) ||
      globalParams.defaultStarsColor === rgbToHex(params.starsColor)
        ? null
        : rgbToHex(params.starsColor),
  };
}

export function useFieldSettings(
  ctx: RenderFieldExtensionCtx,
): [number, string] {
  const validGlobalParams = normalizeGlobalParams(
    ctx.plugin.attributes.parameters,
  );

  const validFieldParams = normalizeFieldParams(
    ctx.parameters as FieldParams,
    validGlobalParams,
  );

  return [
    validFieldParams.maxRating || validGlobalParams.defaultMaxRating,
    validFieldParams.starsColor || validGlobalParams.defaultStarsColor,
  ];
}
