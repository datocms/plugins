import {
  DEFAULT_ASPECT_RATIO,
  DEFAULT_WIDTH,
  DEFAULT_COLUMNS,
  DEFAULT_ROWS,
} from '../constants';
import type {
  ValidGlobalParams,
  FieldParams,
  FieldParamsLegacy,
  FieldParamsLayout,
  ValidFieldParams,
  LayoutConfig,
} from '../types';

export function isValidGlobalParams(
  params: Record<string, unknown>
): params is ValidGlobalParams {
  return (
    params &&
    params.paramsVersion === '1' &&
    typeof params.defaultAspectRatio === 'string' &&
    typeof params.defaultWidth === 'number'
  );
}

export function normalizeGlobalParams(
  params: Record<string, unknown>
): ValidGlobalParams {
  if (isValidGlobalParams(params)) {
    return params;
  }

  return {
    paramsVersion: '1',
    defaultAspectRatio:
      typeof params?.defaultAspectRatio === 'string'
        ? params.defaultAspectRatio
        : DEFAULT_ASPECT_RATIO,
    defaultWidth:
      typeof params?.defaultWidth === 'number'
        ? params.defaultWidth
        : DEFAULT_WIDTH,
  };
}

export function isValidFieldParamsLegacy(
  params: Record<string, unknown>
): params is FieldParamsLegacy {
  return (
    params &&
    (params.paramsVersion === '1' || !params.paramsVersion) &&
    (params.mode === 'single' || params.mode === 'multiple')
  );
}

export function isValidFieldParamsLayout(
  params: Record<string, unknown>
): params is FieldParamsLayout {
  return (
    params &&
    params.paramsVersion === '2' &&
    params.mode === 'layout' &&
    isValidLayoutConfig(params.layoutConfig)
  );
}

export function isValidLayoutConfig(
  config: unknown
): config is LayoutConfig {
  if (!config || typeof config !== 'object') return false;
  const c = config as Record<string, unknown>;
  return (
    typeof c.columns === 'number' &&
    typeof c.rows === 'number' &&
    Array.isArray(c.slots) &&
    c.slots.every(
      (slot: unknown) =>
        slot &&
        typeof slot === 'object' &&
        typeof (slot as Record<string, unknown>).id === 'string' &&
        typeof (slot as Record<string, unknown>).label === 'string' &&
        typeof (slot as Record<string, unknown>).aspectRatio === 'string' &&
        typeof (slot as Record<string, unknown>).width === 'number' &&
        typeof (slot as Record<string, unknown>).row === 'number' &&
        typeof (slot as Record<string, unknown>).col === 'number' &&
        typeof (slot as Record<string, unknown>).required === 'boolean'
    )
  );
}

export function isValidFieldParams(
  params: Record<string, unknown>
): params is FieldParams {
  return isValidFieldParamsLegacy(params) || isValidFieldParamsLayout(params);
}

export function normalizeFieldParams(
  params: Record<string, unknown>
): ValidFieldParams {
  // Handle layout mode
  if (params.mode === 'layout') {
    const rawConfig = params.layoutConfig as Record<string, unknown> | undefined;
    const layoutConfig = normalizeLayoutConfig(rawConfig);
    return {
      mode: 'layout',
      layoutConfig,
    };
  }

  // Handle legacy single/multiple modes
  const fieldParams = params as Partial<FieldParamsLegacy>;

  return {
    mode: fieldParams.mode === 'multiple' ? 'multiple' : 'single',
    aspectRatio:
      typeof fieldParams.overrideDefaultAspectRatio === 'string'
        ? fieldParams.overrideDefaultAspectRatio
        : null,
    width:
      typeof fieldParams.overrideDefaultWidth === 'number'
        ? fieldParams.overrideDefaultWidth
        : null,
  };
}

export function createDefaultLayoutConfig(): LayoutConfig {
  return {
    columns: DEFAULT_COLUMNS,
    rows: DEFAULT_ROWS,
    slots: [],
  };
}

export function normalizeLayoutConfig(
  config: Record<string, unknown> | undefined
): LayoutConfig {
  if (!config) {
    return createDefaultLayoutConfig();
  }

  return {
    columns: typeof config.columns === 'number' ? config.columns : DEFAULT_COLUMNS,
    rows: typeof config.rows === 'number' ? config.rows : DEFAULT_ROWS,
    slots: Array.isArray(config.slots) ? config.slots : [],
  };
}

export function getEffectiveDefaults(
  fieldParams: ValidFieldParams,
  globalParams: ValidGlobalParams
): { aspectRatio: string; width: number } {
  if (fieldParams.mode === 'layout') {
    // Layout mode doesn't use global defaults - each slot has its own settings
    return {
      aspectRatio: globalParams.defaultAspectRatio,
      width: globalParams.defaultWidth,
    };
  }

  return {
    aspectRatio: fieldParams.aspectRatio ?? globalParams.defaultAspectRatio,
    width: fieldParams.width ?? globalParams.defaultWidth,
  };
}
