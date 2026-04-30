import {
  DEFAULT_ASPECT_RATIO,
  DEFAULT_COLUMNS,
  DEFAULT_ROWS,
  DEFAULT_WIDTH,
} from '../constants';
import type {
  FieldParams,
  FieldParamsLayout,
  FieldParamsLegacy,
  LayoutConfig,
  LayoutSlot,
  ValidFieldParams,
  ValidGlobalParams,
} from '../types';
import { isWidthValue, normalizeWidthPresets } from './width';

export function isValidGlobalParams(
  params: Record<string, unknown>,
): params is ValidGlobalParams {
  return (
    params &&
    params.paramsVersion === '1' &&
    typeof params.defaultAspectRatio === 'string' &&
    isWidthValue(params.defaultWidth) &&
    Array.isArray(params.widthPresets)
  );
}

export function normalizeGlobalParams(
  params: Record<string, unknown>,
): ValidGlobalParams {
  if (isValidGlobalParams(params)) {
    return {
      ...params,
      widthPresets: normalizeWidthPresets(params.widthPresets),
    };
  }

  return {
    paramsVersion: '1',
    defaultAspectRatio:
      typeof params?.defaultAspectRatio === 'string'
        ? params.defaultAspectRatio
        : DEFAULT_ASPECT_RATIO,
    defaultWidth: isWidthValue(params?.defaultWidth)
      ? params.defaultWidth
      : DEFAULT_WIDTH,
    widthPresets: normalizeWidthPresets(params?.widthPresets),
  };
}

export function isValidFieldParamsLegacy(
  params: Record<string, unknown>,
): params is FieldParamsLegacy {
  return (
    params &&
    (params.paramsVersion === '1' || !params.paramsVersion) &&
    (params.mode === 'single' || params.mode === 'multiple')
  );
}

export function isValidFieldParamsLayout(
  params: Record<string, unknown>,
): params is FieldParamsLayout {
  return (
    params &&
    params.paramsVersion === '2' &&
    params.mode === 'layout' &&
    isValidLayoutConfig(params.layoutConfig)
  );
}

export function isValidLayoutConfig(config: unknown): config is LayoutConfig {
  if (!config || typeof config !== 'object') return false;
  const c = config as Record<string, unknown>;
  return (
    typeof c.columns === 'number' &&
    typeof c.rows === 'number' &&
    (c.layoutStyle === undefined ||
      c.layoutStyle === 'grid' ||
      c.layoutStyle === 'masonry') &&
    (c.layoutAspectRatio === undefined ||
      typeof c.layoutAspectRatio === 'string') &&
    (c.layoutCustomAspectRatio === undefined ||
      typeof c.layoutCustomAspectRatio === 'string') &&
    (c.layoutWidth === undefined || typeof c.layoutWidth === 'number') &&
    Array.isArray(c.slots) &&
    c.slots.every(
      (slot: unknown) =>
        slot &&
        typeof slot === 'object' &&
        typeof (slot as Record<string, unknown>).id === 'string' &&
        typeof (slot as Record<string, unknown>).label === 'string' &&
        typeof (slot as Record<string, unknown>).aspectRatio === 'string' &&
        isWidthValue((slot as Record<string, unknown>).width) &&
        typeof (slot as Record<string, unknown>).row === 'number' &&
        typeof (slot as Record<string, unknown>).col === 'number' &&
        ((slot as Record<string, unknown>).rowSpan === undefined ||
          typeof (slot as Record<string, unknown>).rowSpan === 'number') &&
        ((slot as Record<string, unknown>).colSpan === undefined ||
          typeof (slot as Record<string, unknown>).colSpan === 'number') &&
        ((slot as Record<string, unknown>).autoSpan === undefined ||
          typeof (slot as Record<string, unknown>).autoSpan === 'boolean') &&
        typeof (slot as Record<string, unknown>).required === 'boolean',
    )
  );
}

export function isValidFieldParams(
  params: Record<string, unknown>,
): params is FieldParams {
  return isValidFieldParamsLegacy(params) || isValidFieldParamsLayout(params);
}

export function normalizeFieldParams(
  params: Record<string, unknown>,
): ValidFieldParams {
  const enableCssClass =
    typeof params.enableCssClass === 'boolean' ? params.enableCssClass : false;
  const enableLazyLoading =
    typeof params.enableLazyLoading === 'boolean'
      ? params.enableLazyLoading
      : false;
  // Handle layout mode
  if (params.mode === 'layout') {
    const rawConfig = params.layoutConfig as
      | Record<string, unknown>
      | undefined;
    const layoutConfig = normalizeLayoutConfig(rawConfig);
    return {
      mode: 'layout',
      layoutConfig,
      enableCssClass,
      enableLazyLoading,
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
    width: isWidthValue(fieldParams.overrideDefaultWidth)
      ? fieldParams.overrideDefaultWidth
      : null,
    enableCssClass,
    enableLazyLoading,
  };
}

export function createDefaultLayoutConfig(): LayoutConfig {
  return {
    columns: DEFAULT_COLUMNS,
    rows: DEFAULT_ROWS,
    slots: [],
    layoutStyle: 'grid',
  };
}

function normalizeLayoutSlot(
  slot: unknown,
  rows: number,
  columns: number,
  index: number,
): LayoutSlot {
  const raw =
    slot && typeof slot === 'object' ? (slot as Record<string, unknown>) : {};
  const rowSpan =
    typeof raw.rowSpan === 'number' && raw.rowSpan > 0 ? raw.rowSpan : 1;
  const colSpan =
    typeof raw.colSpan === 'number' && raw.colSpan > 0 ? raw.colSpan : 1;
  const row = typeof raw.row === 'number' ? raw.row : 0;
  const col = typeof raw.col === 'number' ? raw.col : 0;
  const autoSpan = typeof raw.autoSpan === 'boolean' ? raw.autoSpan : false;
  const width = isWidthValue(raw.width) ? raw.width : DEFAULT_WIDTH;
  const normalizedSlot: LayoutSlot = {
    id: typeof raw.id === 'string' ? raw.id : `slot-${index + 1}`,
    label: typeof raw.label === 'string' ? raw.label : `Slot ${index + 1}`,
    aspectRatio:
      typeof raw.aspectRatio === 'string'
        ? raw.aspectRatio
        : DEFAULT_ASPECT_RATIO,
    width,
    row,
    col,
    rowSpan: Math.min(rowSpan, Math.max(1, rows - row)),
    colSpan: Math.min(colSpan, Math.max(1, columns - col)),
    autoSpan,
    required: typeof raw.required === 'boolean' ? raw.required : false,
  };

  if (typeof raw.customAspectRatio === 'string') {
    normalizedSlot.customAspectRatio = raw.customAspectRatio;
  }

  return normalizedSlot;
}

export function normalizeLayoutConfig(
  config: Record<string, unknown> | undefined,
): LayoutConfig {
  if (!config) {
    return createDefaultLayoutConfig();
  }

  const columns =
    typeof config.columns === 'number' ? config.columns : DEFAULT_COLUMNS;
  const rows = typeof config.rows === 'number' ? config.rows : DEFAULT_ROWS;
  const layoutStyle = config.layoutStyle === 'masonry' ? 'masonry' : 'grid';
  const layoutAspectRatio =
    typeof config.layoutAspectRatio === 'string'
      ? config.layoutAspectRatio
      : undefined;
  const layoutCustomAspectRatio =
    typeof config.layoutCustomAspectRatio === 'string'
      ? config.layoutCustomAspectRatio
      : undefined;
  const layoutWidth =
    typeof config.layoutWidth === 'number' ? config.layoutWidth : undefined;

  const slots = Array.isArray(config.slots)
    ? config.slots.map((slot, index) =>
        normalizeLayoutSlot(slot, rows, columns, index),
      )
    : [];

  return {
    columns,
    rows,
    slots,
    layoutStyle,
    layoutAspectRatio,
    layoutCustomAspectRatio,
    layoutWidth,
  };
}

export function getEffectiveDefaults(
  fieldParams: ValidFieldParams,
  globalParams: ValidGlobalParams,
): { aspectRatio: string; width: ValidGlobalParams['defaultWidth'] } {
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
