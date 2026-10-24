import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import InputGroup from 'datocms-react-ui/InputGroup';
import RadioGroupInput from 'datocms-react-ui/RadioGroupInput';
import SelectInput from 'datocms-react-ui/SelectInput';
import StringInput from 'datocms-react-ui/StringInput';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ASPECT_RATIO_OPTIONS,
  COLUMN_OPTIONS,
  DEFAULT_WIDTH,
  ROW_OPTIONS,
} from '../../constants';
import type { LayoutConfig, WidthOption } from '../../types';
import { validateCustomAspectRatio } from '../../utils/aspectRatio';
import {
  AUTO_OPTION_VALUE,
  buildAspectRatioSelectOptions,
  buildWidthSelectOptions,
  CUSTOM_OPTION_VALUE,
  type SelectOption,
} from '../../utils/options';
import { parseCustomWidth, validateCustomWidth } from '../../utils/width';
import {
  applyLayoutAspectRatioChange,
  applyLayoutStyleChange,
  buildLayoutDimensions,
  deriveLayoutAspectRatioSelection,
  deriveLayoutCustomAspectRatioValue,
} from './grid';

const LAYOUT_STYLE_OPTIONS = [
  {
    value: 'grid',
    label: 'Grid',
    hint: 'Slots sit in a grid of rows and columns, and can span several cells.',
  },
  {
    value: 'masonry',
    label: 'Masonry',
    hint: 'Slots flow into columns in their order, each as tall as its aspect ratio.',
  },
] as const;

// Four options to compare: radios, not a select
const COLUMN_RADIO_OPTIONS = COLUMN_OPTIONS.map((option) => ({
  value: String(option.value),
  label: option.label,
}));

const ROW_SELECT_OPTIONS: SelectOption[] = ROW_OPTIONS.map((option) => ({
  value: String(option.value),
  label: option.label,
}));

const AUTO_OPTION: SelectOption = { value: AUTO_OPTION_VALUE, label: 'Auto' };

// The whole layout has no Original ratio: it is not an asset
const LAYOUT_ASPECT_RATIO_SELECT_OPTIONS: SelectOption[] = [
  AUTO_OPTION,
  ...buildAspectRatioSelectOptions({ includeOriginal: false }),
];

const LAYOUT_PRESET_ASPECT_RATIO_VALUES = ASPECT_RATIO_OPTIONS.filter(
  (opt) => opt.value !== CUSTOM_OPTION_VALUE && opt.value !== 'original',
).map((opt) => opt.value);

type UseLayoutWidthControlsArgs = {
  config: LayoutConfig;
  layoutPresetWidthValues: (string | number)[];
  onChange: (config: LayoutConfig) => void;
};

function useLayoutWidthControls({
  config,
  layoutPresetWidthValues,
  onChange,
}: UseLayoutWidthControlsArgs) {
  const layoutWidthIsCustomValue =
    typeof config.layoutWidth === 'number' &&
    !layoutPresetWidthValues.includes(config.layoutWidth);

  const [layoutCustomWidthActive, setLayoutCustomWidthActive] = useState(
    layoutWidthIsCustomValue,
  );
  const [layoutCustomWidthInput, setLayoutCustomWidthInput] = useState(
    layoutWidthIsCustomValue && config.layoutWidth
      ? String(config.layoutWidth)
      : '',
  );

  useEffect(() => {
    if (layoutWidthIsCustomValue) {
      setLayoutCustomWidthActive(true);
      setLayoutCustomWidthInput(String(config.layoutWidth));
      return;
    }
    if (config.layoutWidth === undefined) {
      setLayoutCustomWidthActive(false);
      setLayoutCustomWidthInput('');
    }
  }, [config.layoutWidth, layoutWidthIsCustomValue]);

  const layoutCustomWidthError = layoutCustomWidthActive
    ? validateCustomWidth(layoutCustomWidthInput)
    : undefined;

  let layoutWidthSelection = String(config.layoutWidth);
  if (config.layoutWidth === undefined) {
    layoutWidthSelection = AUTO_OPTION_VALUE;
  } else if (layoutCustomWidthActive) {
    layoutWidthSelection = CUSTOM_OPTION_VALUE;
  }

  const handleLayoutWidthChange = useCallback(
    (value: string) => {
      if (value === AUTO_OPTION_VALUE) {
        setLayoutCustomWidthActive(false);
        setLayoutCustomWidthInput('');
        onChange({ ...config, layoutWidth: undefined });
        return;
      }
      if (value === CUSTOM_OPTION_VALUE) {
        const fallback =
          typeof config.layoutWidth === 'number'
            ? config.layoutWidth
            : DEFAULT_WIDTH;
        setLayoutCustomWidthActive(true);
        setLayoutCustomWidthInput(String(fallback));
        onChange({ ...config, layoutWidth: fallback });
        return;
      }
      setLayoutCustomWidthActive(false);
      setLayoutCustomWidthInput('');
      onChange({ ...config, layoutWidth: Number(value) });
    },
    [config, onChange],
  );

  const handleLayoutCustomWidthInputChange = useCallback(
    (value: string) => {
      setLayoutCustomWidthInput(value);
      const parsed = parseCustomWidth(value);
      if (parsed !== null && !validateCustomWidth(value)) {
        onChange({ ...config, layoutWidth: parsed });
      }
    },
    [config, onChange],
  );

  return {
    layoutCustomWidthActive,
    layoutCustomWidthInput,
    layoutCustomWidthError,
    layoutWidthSelection,
    handleLayoutWidthChange,
    handleLayoutCustomWidthInputChange,
  };
}

type LayoutSettingsProps = {
  config: LayoutConfig;
  widthOptions: WidthOption[];
  onChange: (config: LayoutConfig) => void;
  onColumnsChange: (columns: number) => void;
  onRowsChange: (rows: number) => void;
};

/**
 * The settings of the whole layout: its style, its grid, and the aspect
 * ratio and width that the whole layout has, if any.
 */
export default function LayoutSettings({
  config,
  widthOptions,
  onChange,
  onColumnsChange,
  onRowsChange,
}: LayoutSettingsProps) {
  const layoutStyle = config.layoutStyle ?? 'grid';
  const isMasonry = layoutStyle === 'masonry';

  const handleLayoutStyleChange = (next: string | null) => {
    if (next === null || next === layoutStyle) return;
    onChange(
      applyLayoutStyleChange(config, next === 'masonry' ? 'masonry' : 'grid'),
    );
  };

  return (
    <>
      <FieldWrapper label="Layout style">
        <RadioGroupInput
          options={LAYOUT_STYLE_OPTIONS}
          value={layoutStyle}
          onChange={handleLayoutStyleChange}
        />
      </FieldWrapper>

      <FieldWrapper label="Columns">
        <RadioGroupInput
          small
          options={COLUMN_RADIO_OPTIONS}
          value={String(config.columns)}
          onChange={(next) => {
            if (next !== null) onColumnsChange(Number(next));
          }}
        />
      </FieldWrapper>

      {!isMasonry && (
        <FieldWrapper label="Rows">
          <SelectInput
            value={String(config.rows)}
            onChange={(next) => {
              if (next !== null) onRowsChange(Number(next));
            }}
            options={ROW_SELECT_OPTIONS}
            clearable={false}
          />
        </FieldWrapper>
      )}

      <LayoutSizeFields
        config={config}
        widthOptions={widthOptions}
        onChange={onChange}
      />
    </>
  );
}

type LayoutSizeFieldsProps = {
  config: LayoutConfig;
  widthOptions: WidthOption[];
  onChange: (config: LayoutConfig) => void;
};

/**
 * The aspect ratio controls of the whole layout. Auto stores none; a stored
 * ratio that is no preset shows as Custom, with its text in the input,
 * which saves each keystroke.
 */
function layoutAspectRatioControls({
  config,
  onChange,
}: Omit<LayoutSizeFieldsProps, 'widthOptions'>) {
  const selection = deriveLayoutAspectRatioSelection(
    config.layoutAspectRatio,
    LAYOUT_PRESET_ASPECT_RATIO_VALUES,
  );
  const customAspectRatio = deriveLayoutCustomAspectRatioValue(
    config.layoutAspectRatio,
    config.layoutCustomAspectRatio,
    LAYOUT_PRESET_ASPECT_RATIO_VALUES,
  );

  const handleSelectChange = (next: string | null) => {
    if (next !== null) {
      onChange(applyLayoutAspectRatioChange(config, next, customAspectRatio));
    }
  };

  const handleCustomChange = (next: string | null) =>
    onChange({
      ...config,
      layoutAspectRatio: CUSTOM_OPTION_VALUE,
      layoutCustomAspectRatio: next ?? '',
    });

  return {
    selection,
    isCustom: selection === CUSTOM_OPTION_VALUE,
    customAspectRatio,
    handleSelectChange,
    handleCustomChange,
  };
}

/**
 * The aspect ratio and the width of the whole layout, side by side. Auto
 * stores none. While Custom is picked in one of them (or both), a second
 * row holds the custom inputs, one cell each; a typed custom width saves
 * only when it is valid, while the input keeps the text. The hint of the
 * width gives the size of the whole layout when it has both a ratio and a
 * width.
 */
function LayoutSizeFields({
  config,
  widthOptions,
  onChange,
}: LayoutSizeFieldsProps) {
  // The whole layout has no Original width: it is not an asset
  const layoutPresetWidthOptions = useMemo(
    () => widthOptions.filter((opt) => opt.value !== 'original'),
    [widthOptions],
  );
  const layoutPresetWidthValues = useMemo(
    () => layoutPresetWidthOptions.map((opt) => opt.value),
    [layoutPresetWidthOptions],
  );
  const widthSelectOptions = useMemo(
    () => [AUTO_OPTION, ...buildWidthSelectOptions(layoutPresetWidthOptions)],
    [layoutPresetWidthOptions],
  );
  const ratio = layoutAspectRatioControls({ config, onChange });
  const width = useLayoutWidthControls({
    config,
    layoutPresetWidthValues,
    onChange,
  });

  const dimensions = buildLayoutDimensions(config);

  return (
    <>
      <div className="form__field form__row">
        <div className="form__row__cell">
          <FieldWrapper
            label="Layout aspect ratio"
            hint="The shape of the whole layout. Auto leaves it out."
          >
            <SelectInput
              value={ratio.selection}
              onChange={ratio.handleSelectChange}
              options={LAYOUT_ASPECT_RATIO_SELECT_OPTIONS}
              clearable={false}
            />
          </FieldWrapper>
        </div>
        <div className="form__row__cell">
          <FieldWrapper
            label="Layout width"
            hint={
              dimensions
                ? `The whole layout is ${dimensions}.`
                : 'The width of the whole layout. Auto leaves it out.'
            }
          >
            <SelectInput
              value={width.layoutWidthSelection}
              onChange={(next) => {
                if (next !== null) width.handleLayoutWidthChange(next);
              }}
              options={widthSelectOptions}
              clearable={false}
            />
          </FieldWrapper>
        </div>
      </div>
      {(ratio.isCustom || width.layoutCustomWidthActive) && (
        <div className="form__field form__row">
          {ratio.isCustom && (
            <div className="form__row__cell">
              <FieldWrapper
                label="Custom layout aspect ratio"
                error={validateCustomAspectRatio(ratio.customAspectRatio)}
              >
                <StringInput
                  placeholder="2.35:1"
                  value={ratio.customAspectRatio}
                  onChange={ratio.handleCustomChange}
                />
              </FieldWrapper>
            </div>
          )}
          {width.layoutCustomWidthActive && (
            <div className="form__row__cell">
              <FieldWrapper
                label="Custom layout width"
                error={width.layoutCustomWidthError}
              >
                <InputGroup
                  value={width.layoutCustomWidthInput}
                  onChange={(next) =>
                    width.handleLayoutCustomWidthInputChange(next ?? '')
                  }
                  post="px"
                  inputMode="numeric"
                  placeholder={String(DEFAULT_WIDTH)}
                />
              </FieldWrapper>
            </div>
          )}
        </div>
      )}
    </>
  );
}
