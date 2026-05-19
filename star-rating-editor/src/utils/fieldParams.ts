import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import { normalizeGlobalParams, type ValidGlobalParams } from './globalParams';

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

export type FieldParams =
  | ValidFieldParams
  | LegacyFieldParams
  | Record<string, unknown>
  | null
  | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isValidFieldParams(
  params: unknown,
): params is ValidFieldParams {
  return isRecord(params) && params.paramsVersion === '2';
}

function rgbToHex({ red, blue, green }: LegacyFieldParams['starsColor']) {
  return `#${((1 << 24) + (red << 16) + (green << 8) + blue).toString(16).slice(1).toUpperCase()}`;
}

function isLegacyStarsColor(
  value: unknown,
): value is LegacyFieldParams['starsColor'] {
  return (
    isRecord(value) &&
    typeof value.red === 'number' &&
    typeof value.blue === 'number' &&
    typeof value.green === 'number'
  );
}

export function normalizeFieldParams(
  params: unknown,
  globalParams: ValidGlobalParams,
): ValidFieldParams {
  if (isValidFieldParams(params)) {
    return params;
  }

  const paramsRecord = isRecord(params) ? params : {};
  const maxRating =
    typeof paramsRecord.maxRating === 'number' ? paramsRecord.maxRating : null;
  const starsColor = isLegacyStarsColor(paramsRecord.starsColor)
    ? rgbToHex(paramsRecord.starsColor)
    : null;

  return {
    paramsVersion: '2',
    maxRating:
      maxRating === null ||
      globalParams.defaultMaxRating === maxRating
        ? null
        : maxRating,
    starsColor:
      starsColor === null ||
      globalParams.defaultStarsColor === starsColor
        ? null
        : starsColor,
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
