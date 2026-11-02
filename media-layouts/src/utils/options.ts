import { ASPECT_RATIO_OPTIONS } from '../constants';
import type { LayoutSlot, WidthOption, WidthValue } from '../types';
import { formatDimensions, getEffectiveRatio } from './aspectRatio';
import { getWidthLabel, resolveWidthValue } from './width';

/** The option that reveals a custom input. It is also the stored value 'custom'. */
export const CUSTOM_OPTION_VALUE = 'custom';

/** UI only: the layout has no ratio or width of its own. Never stored. */
export const AUTO_OPTION_VALUE = 'auto';

/** UI only: the field uses the plugin default (no override key). Never stored. */
export const PLUGIN_DEFAULT_OPTION_VALUE = '__plugin-default';

export type SelectOption = {
  value: string;
  label: string;
};

/**
 * The aspect ratio presets as select options (Original only when asked),
 * followed by the custom entry.
 */
export function buildAspectRatioSelectOptions({
  includeOriginal,
}: {
  includeOriginal: boolean;
}): SelectOption[] {
  const options: SelectOption[] = [];
  for (const option of ASPECT_RATIO_OPTIONS) {
    if (option.value === CUSTOM_OPTION_VALUE) continue;
    if (!includeOriginal && option.value === 'original') continue;
    options.push({ value: option.value, label: option.label });
  }
  options.push({ value: CUSTOM_OPTION_VALUE, label: 'Custom ratio' });
  return options;
}

/** The width options with string values, followed by the custom entry. */
export function buildWidthSelectOptions(
  widthOptions: WidthOption[],
): SelectOption[] {
  const options: SelectOption[] = [];
  for (const option of widthOptions) {
    options.push({
      value: widthToOptionValue(option.value),
      label: option.label,
    });
  }
  options.push({ value: CUSTOM_OPTION_VALUE, label: 'Custom width' });
  return options;
}

export function widthToOptionValue(width: WidthValue): string {
  return width === 'original' ? 'original' : String(width);
}

/**
 * The width of a width option. Call it for preset values only: the custom
 * and UI-only options are handled before.
 */
export function optionValueToWidth(value: string): WidthValue {
  return value === 'original' ? 'original' : Number(value);
}

/** Whether the value is one of the aspect ratio presets (not custom). */
export function isPresetAspectRatio(value: string): boolean {
  if (value === CUSTOM_OPTION_VALUE) return false;
  return ASPECT_RATIO_OPTIONS.some((option) => option.value === value);
}

/**
 * The short name of an aspect ratio: '16:9', 'Original', the custom text, or
 * the stored text when it is not a preset.
 */
export function getAspectRatioShortLabel(
  aspectRatio: string,
  customAspectRatio?: string,
): string {
  if (aspectRatio === CUSTOM_OPTION_VALUE) {
    return customAspectRatio || 'Custom';
  }
  const preset = ASPECT_RATIO_OPTIONS.find(
    (option) => option.value === aspectRatio,
  );
  if (preset) {
    return preset.label.split(' ')[0] || aspectRatio;
  }
  return aspectRatio || 'Custom';
}

type DescribeSizeArgs = {
  aspectRatio: string;
  customAspectRatio?: string;
  width: WidthValue;
  widthOptions: WidthOption[];
  originalWidth?: number | null;
  originalHeight?: number | null;
};

/**
 * The crop and size of an asset or slot: '16:9 · 1920 × 1080 px', or
 * '16:9 · Original' when the size can't be computed.
 */
export function describeSize({
  aspectRatio,
  customAspectRatio,
  width,
  widthOptions,
  originalWidth,
  originalHeight,
}: DescribeSizeArgs): string {
  const shortLabel = getAspectRatioShortLabel(aspectRatio, customAspectRatio);
  const ratio = getEffectiveRatio(
    aspectRatio,
    customAspectRatio,
    originalWidth,
    originalHeight,
  );
  const resolvedWidth = resolveWidthValue(width, originalWidth);
  if (ratio && ratio > 0 && resolvedWidth) {
    return `${shortLabel} · ${formatDimensions(resolvedWidth, ratio)}`;
  }
  return `${shortLabel} · ${getWidthLabel(width, widthOptions)}`;
}

/**
 * The name of a slot: its label, or 'Untitled slot' when the label is blank
 * (a name that can't pass for a label). The field validation names the slot
 * in the same way.
 */
export function slotTitle(slot: Pick<LayoutSlot, 'label'>): string {
  return (slot.label ?? '').trim() || 'Untitled slot';
}

/**
 * The name of an asset: its filename, or 'Asset 123' when it has none. A
 * stored value that is no asset (left over from another mode of the field)
 * has no upload id either: it is an 'Unknown asset'.
 */
export function assetTitle({
  filename,
  uploadId,
}: {
  filename?: string | null;
  uploadId?: string | null;
}): string {
  const name = typeof filename === 'string' ? filename.trim() : '';
  if (name) return name;
  return uploadId ? `Asset ${uploadId}` : 'Unknown asset';
}
