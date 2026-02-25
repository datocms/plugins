export type AspectRatioOption = {
  value: string;
  label: string;
  ratio: number | null; // null for 'custom'
};

export type WidthValue = number | 'original';

export type WidthOption = {
  value: WidthValue;
  label: string;
};

export type CustomWidthPreset = {
  value: number;
  label: string;
};

// The data stored for each asset in the JSON field
export type MediaLayoutItem = {
  uploadId: string;
  url: string;
  filename: string;
  format: string | null;
  size: number;
  alt: string | null;
  title: string | null;
  cssClass?: string;
  lazyLoading?: boolean;
  focalPoint: { x: number; y: number } | null;
  aspectRatio: string;
  customAspectRatio?: string;
  width: WidthValue;
  height: number; // Calculated from width and aspectRatio for easy imgix param usage
  originalWidth: number | null; // Original image dimensions for "original" aspect ratio
  originalHeight: number | null;
};

// Field value types
export type SingleFieldValue = MediaLayoutItem | null;
export type MultipleFieldValue = MediaLayoutItem[];
export type FieldValue = SingleFieldValue | MultipleFieldValue;

// Layout mode types
export type LayoutSlot = {
  id: string;
  label: string;
  aspectRatio: string;
  customAspectRatio?: string;
  width: WidthValue;
  row: number;
  col: number;
  rowSpan?: number;
  colSpan?: number;
  autoSpan?: boolean;
  required: boolean;
};

export type LayoutConfig = {
  slots: LayoutSlot[];
  columns: number;
  rows: number;
  layoutStyle?: 'grid' | 'masonry';
  layoutAspectRatio?: string;
  layoutCustomAspectRatio?: string;
  layoutWidth?: number;
};

export type SlotAssignment = {
  slotId: string;
  uploadId: string;
  url: string;
  filename: string;
  format: string | null;
  size: number;
  alt: string | null;
  title: string | null;
  cssClass?: string;
  lazyLoading?: boolean;
  focalPoint: { x: number; y: number } | null;
  aspectRatio: string;
  customAspectRatio?: string;
  width: WidthValue;
  height: number;
  originalWidth: number | null;
  originalHeight: number | null;
};

export type LayoutFieldValue = {
  layout: LayoutConfig;
  assignments: SlotAssignment[];
};

// Plugin parameters
export type GlobalParams = {
  paramsVersion: '1';
  defaultAspectRatio: string;
  defaultWidth: WidthValue;
  widthPresets: CustomWidthPreset[];
};

// Field params for single/multiple modes (legacy)
export type FieldParamsLegacy = {
  paramsVersion: '1';
  mode: 'single' | 'multiple';
  overrideDefaultAspectRatio?: string;
  overrideDefaultWidth?: WidthValue;
  enableCssClass?: boolean;
  enableLazyLoading?: boolean;
};

// Field params for layout mode
export type FieldParamsLayout = {
  paramsVersion: '2';
  mode: 'layout';
  layoutConfig: LayoutConfig;
  enableCssClass?: boolean;
  enableLazyLoading?: boolean;
};

export type FieldParams = FieldParamsLegacy | FieldParamsLayout;

export type ValidGlobalParams = GlobalParams;

export type ValidFieldParams =
  | {
      mode: 'single' | 'multiple';
      aspectRatio: string | null;
      width: WidthValue | null;
      enableCssClass: boolean;
      enableLazyLoading: boolean;
    }
  | {
      mode: 'layout';
      layoutConfig: LayoutConfig;
      enableCssClass: boolean;
      enableLazyLoading: boolean;
    };

// Upload data from DatoCMS API
export type UploadAttributes = {
  filename: string;
  url: string;
  width: number | null;
  height: number | null;
  format: string | null;
  size: number;
  default_field_metadata: Record<
    string,
    {
      alt: string | null;
      title: string | null;
      custom_data: Record<string, unknown>;
      focal_point: { x: number; y: number } | null;
    }
  >;
};

export type Upload = {
  id: string;
  type: 'upload';
  attributes: UploadAttributes;
};
