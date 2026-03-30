import { WIDTH_OPTIONS } from '../constants';
import type { CustomWidthPreset, WidthOption, WidthValue } from '../types';

export const MIN_WIDTH = 1;
export const MAX_WIDTH = 10000;

export function isWidthValue(value: unknown): value is WidthValue {
  return value === 'original' || (typeof value === 'number' && !Number.isNaN(value));
}

export function isValidWidthNumber(value: number): boolean {
  return Number.isFinite(value) && value >= MIN_WIDTH && value <= MAX_WIDTH;
}

export function parseCustomWidth(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

export function validateCustomWidth(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'Please enter a custom width';
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return 'Width must be a number';
  }
  if (!isValidWidthNumber(parsed)) {
    return `Width must be between ${MIN_WIDTH} and ${MAX_WIDTH}`;
  }
  return undefined;
}

export function normalizeWidthPresets(value: unknown): CustomWidthPreset[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  const presets: CustomWidthPreset[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    const label =
      typeof raw.label === 'string' ? raw.label.trim() : '';
    const numericValue =
      typeof raw.value === 'number' ? raw.value : Number(raw.value);
    if (!label) continue;
    if (!isValidWidthNumber(numericValue)) continue;
    if (seen.has(numericValue)) continue;
    seen.add(numericValue);
    presets.push({ value: numericValue, label });
  }
  return presets;
}

export function buildWidthOptions(
  presets: CustomWidthPreset[] = [],
  includeOriginal = true
): WidthOption[] {
  const customValues = new Set(presets.map((preset) => preset.value));
  const baseOptions = WIDTH_OPTIONS.filter((opt) => {
    if (opt.value === 'original') return includeOriginal;
    return !customValues.has(opt.value as number);
  });
  const originalOption = baseOptions.find((opt) => opt.value === 'original');
  const baseNumericOptions = baseOptions.filter((opt) => opt.value !== 'original');
  const customOptions: WidthOption[] = presets.map((preset) => ({
    value: preset.value,
    label: preset.label,
  }));
  return [
    ...(originalOption ? [originalOption] : []),
    ...customOptions,
    ...baseNumericOptions,
  ];
}

export function resolveWidthValue(
  width: WidthValue,
  originalWidth?: number | null
): number | null {
  if (width === 'original') {
    return originalWidth ?? null;
  }
  return width;
}

export function getWidthLabel(
  width: WidthValue,
  options: WidthOption[] = WIDTH_OPTIONS
): string {
  const option = options.find((opt) => opt.value === width);
  if (option) return option.label;
  return typeof width === 'number' ? `${width}px` : 'Original';
}
