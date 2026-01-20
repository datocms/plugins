import type { AspectRatioOption, WidthOption } from './types';

export const ASPECT_RATIO_OPTIONS: AspectRatioOption[] = [
  { value: 'original', label: 'Original (no crop)', ratio: null },
  { value: '16:9', label: '16:9 (Widescreen)', ratio: 16 / 9 },
  { value: '4:3', label: '4:3 (Standard)', ratio: 4 / 3 },
  { value: '1:1', label: '1:1 (Square)', ratio: 1 },
  { value: '3:2', label: '3:2 (Photo)', ratio: 3 / 2 },
  { value: '2:3', label: '2:3 (Portrait Photo)', ratio: 2 / 3 },
  { value: '21:9', label: '21:9 (Ultrawide)', ratio: 21 / 9 },
  { value: '9:16', label: '9:16 (Portrait/Mobile)', ratio: 9 / 16 },
  { value: '3:4', label: '3:4 (Portrait Standard)', ratio: 3 / 4 },
  { value: 'custom', label: 'Custom...', ratio: null },
];

export const WIDTH_OPTIONS: WidthOption[] = [
  { value: 320, label: '320px (Mobile small)' },
  { value: 640, label: '640px (Mobile)' },
  { value: 768, label: '768px (Tablet)' },
  { value: 1024, label: '1024px (Tablet landscape)' },
  { value: 1280, label: '1280px (Desktop small)' },
  { value: 1920, label: '1920px (Full HD)' },
  { value: 2560, label: '2560px (2K)' },
  { value: 3840, label: '3840px (4K)' },
];

export const DEFAULT_ASPECT_RATIO = '16:9';
export const DEFAULT_WIDTH = 1920;

export const FIELD_EXTENSION_ID = 'mediaLayouts';

export const MODE_OPTIONS = [
  { value: 'single', label: 'Single asset' },
  { value: 'multiple', label: 'Multiple assets (gallery)' },
  { value: 'layout', label: 'Layout (predefined slots)' },
] as const;

export const COLUMN_OPTIONS = [
  { value: 1, label: '1 column' },
  { value: 2, label: '2 columns' },
  { value: 3, label: '3 columns' },
  { value: 4, label: '4 columns' },
] as const;

export const ROW_OPTIONS = [
  { value: 1, label: '1 row' },
  { value: 2, label: '2 rows' },
  { value: 3, label: '3 rows' },
  { value: 4, label: '4 rows' },
  { value: 5, label: '5 rows' },
  { value: 6, label: '6 rows' },
] as const;

export const DEFAULT_COLUMNS = 2;
export const DEFAULT_ROWS = 2;
