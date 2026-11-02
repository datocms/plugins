import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import InputGroup from 'datocms-react-ui/InputGroup';
import SelectInput from 'datocms-react-ui/SelectInput';
import StringInput from 'datocms-react-ui/StringInput';
import SwitchInput from 'datocms-react-ui/SwitchInput';
import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_WIDTH } from '../../constants';
import type { WidthOption, WidthValue } from '../../types';
import {
  formatDimensions,
  getEffectiveRatio,
  validateCustomAspectRatio,
} from '../../utils/aspectRatio';
import {
  buildAspectRatioSelectOptions,
  buildWidthSelectOptions,
  CUSTOM_OPTION_VALUE,
  isPresetAspectRatio,
  optionValueToWidth,
  widthToOptionValue,
} from '../../utils/options';
import {
  parseCustomWidth,
  resolveWidthValue,
  validateCustomWidth,
} from '../../utils/width';

const ASPECT_RATIO_SELECT_OPTIONS = buildAspectRatioSelectOptions({
  includeOriginal: true,
});

/** The crop and the output width of an asset (or of a slot). */
export type CropValue = {
  aspectRatio: string;
  customAspectRatio?: string;
  width: WidthValue;
};

/** The options of one asset that the field settings turn on. */
export type AssetOptionsValue = {
  cssClass?: string;
  lazyLoading?: boolean;
};

/**
 * A stored aspect ratio that is 'custom' or no preset shows as Custom, with
 * its text in the custom input ('' for a new custom ratio).
 */
function computeAspectRatioState({
  aspectRatio,
  customAspectRatio,
}: CropValue) {
  const isCustom = !isPresetAspectRatio(aspectRatio);
  let customValue = '';
  if (aspectRatio === CUSTOM_OPTION_VALUE) {
    customValue = customAspectRatio ?? '';
  } else if (isCustom) {
    customValue = aspectRatio;
  }
  const customError = isCustom
    ? validateCustomAspectRatio(customValue)
    : undefined;
  return { isCustom, customValue, customError };
}

type CropChange = (change: Partial<CropValue>) => void;

/**
 * The aspect ratio controls. Custom keeps the text it had (or ''), and the
 * custom input saves each keystroke, valid or not.
 */
function useAspectRatioControls(value: CropValue, onChange: CropChange) {
  const { isCustom, customValue, customError } = computeAspectRatioState(value);

  const handleSelectChange = (next: string | null) => {
    if (next === null) return;
    if (next === CUSTOM_OPTION_VALUE) {
      onChange({
        aspectRatio: CUSTOM_OPTION_VALUE,
        customAspectRatio: customValue || '',
      });
      return;
    }
    onChange({ aspectRatio: next, customAspectRatio: undefined });
  };

  const handleCustomChange = (next: string | null) =>
    onChange({
      aspectRatio: CUSTOM_OPTION_VALUE,
      customAspectRatio: next ?? '',
    });

  return {
    isCustom,
    customValue,
    customError,
    selectValue: isCustom ? CUSTOM_OPTION_VALUE : value.aspectRatio,
    handleSelectChange,
    handleCustomChange,
  };
}

type UseWidthControlsArgs = {
  width: WidthValue;
  originalWidth?: number | null;
  widthOptions: WidthOption[];
  onChange: CropChange;
};

/**
 * The output width controls. A stored number that matches no option shows
 * as Custom; a typed width saves only when it is valid, while the input
 * keeps the text and shows the error.
 */
function useWidthControls({
  width,
  originalWidth,
  widthOptions,
  onChange,
}: UseWidthControlsArgs) {
  const selectOptions = useMemo(
    () => buildWidthSelectOptions(widthOptions),
    [widthOptions],
  );
  const presetWidthValues = useMemo(
    () => new Set(widthOptions.map((opt) => opt.value)),
    [widthOptions],
  );

  const isCustomWidthValue =
    typeof width === 'number' && !presetWidthValues.has(width);
  const [customWidthActive, setCustomWidthActive] =
    useState(isCustomWidthValue);
  const [customWidthInput, setCustomWidthInput] = useState(
    isCustomWidthValue ? String(width) : '',
  );

  // Follows the stored width: a number that matches no option turns the
  // custom input on with that number, Original turns it off.
  useEffect(() => {
    if (isCustomWidthValue) {
      setCustomWidthActive(true);
      setCustomWidthInput(String(width));
    } else if (width === 'original') {
      setCustomWidthActive(false);
      setCustomWidthInput('');
    }
  }, [width, isCustomWidthValue]);

  const handleSelectChange = (next: string | null) => {
    if (next === null) return;
    if (next === CUSTOM_OPTION_VALUE) {
      const fallback =
        typeof width === 'number'
          ? width
          : (resolveWidthValue(width, originalWidth) ?? DEFAULT_WIDTH);
      setCustomWidthActive(true);
      setCustomWidthInput(String(fallback));
      onChange({ width: fallback });
      return;
    }
    setCustomWidthActive(false);
    setCustomWidthInput('');
    onChange({ width: optionValueToWidth(next) });
  };

  const handleCustomWidthChange = (next: string | null) => {
    const text = next ?? '';
    setCustomWidthInput(text);
    const parsed = parseCustomWidth(text);
    if (parsed !== null && !validateCustomWidth(text)) {
      onChange({ width: parsed });
    }
  };

  return {
    selectOptions,
    selectValue: customWidthActive
      ? CUSTOM_OPTION_VALUE
      : widthToOptionValue(width),
    customWidthActive,
    customWidthInput,
    customWidthError: validateCustomWidth(customWidthInput),
    handleSelectChange,
    handleCustomWidthChange,
  };
}

type CropFieldsProps = {
  value: CropValue;
  /** The width of the original file, for a custom width picked from Original */
  originalWidth?: number | null;
  /** The height of the original file, for the size of an Original crop */
  originalHeight?: number | null;
  widthOptions: WidthOption[];
  disabled?: boolean;
  onChange: CropChange;
};

/** The size that the crop and the width give: '1920 × 1080 px', or null. */
function describeOutputSize(
  value: CropValue,
  originalWidth?: number | null,
  originalHeight?: number | null,
): string | null {
  const ratio = getEffectiveRatio(
    value.aspectRatio,
    value.customAspectRatio,
    originalWidth,
    originalHeight,
  );
  const width = resolveWidthValue(value.width, originalWidth);
  return ratio && ratio > 0 && width ? formatDimensions(width, ratio) : null;
}

/**
 * The aspect ratio and the width of an asset, side by side. Custom shows its
 * input under its own menu, in the same cell. The size that they give is
 * the hint of the last field of the width.
 */
export function CropFields({
  value,
  originalWidth,
  originalHeight,
  widthOptions,
  disabled,
  onChange,
}: CropFieldsProps) {
  const ratio = useAspectRatioControls(value, onChange);
  const width = useWidthControls({
    width: value.width,
    originalWidth,
    widthOptions,
    onChange,
  });
  const outputSize = describeOutputSize(value, originalWidth, originalHeight);
  const sizeHint = outputSize ? `Final size: ${outputSize}.` : undefined;

  return (
    <div className="form__field form__row">
      <div className="form__row__cell">
        <FieldWrapper label="Aspect ratio">
          <SelectInput
            value={ratio.selectValue}
            onChange={ratio.handleSelectChange}
            options={ASPECT_RATIO_SELECT_OPTIONS}
            clearable={false}
            disabled={disabled}
          />
        </FieldWrapper>
        {ratio.isCustom && (
          <FieldWrapper label="Custom aspect ratio" error={ratio.customError}>
            <StringInput
              placeholder="2.35:1"
              value={ratio.customValue}
              onChange={ratio.handleCustomChange}
              disabled={disabled}
            />
          </FieldWrapper>
        )}
      </div>
      <div className="form__row__cell">
        <FieldWrapper
          label="Width"
          hint={width.customWidthActive ? undefined : sizeHint}
        >
          <SelectInput
            value={width.selectValue}
            onChange={width.handleSelectChange}
            options={width.selectOptions}
            clearable={false}
            disabled={disabled}
          />
        </FieldWrapper>
        {width.customWidthActive && (
          <FieldWrapper
            label="Custom width"
            hint={sizeHint}
            error={width.customWidthError}
          >
            <InputGroup
              value={width.customWidthInput}
              onChange={width.handleCustomWidthChange}
              post="px"
              inputMode="numeric"
              placeholder={String(DEFAULT_WIDTH)}
              disabled={disabled}
            />
          </FieldWrapper>
        )}
      </div>
    </div>
  );
}

type AssetOptionFieldsProps = {
  value: AssetOptionsValue;
  enableCssClass: boolean;
  enableLazyLoading: boolean;
  disabled?: boolean;
  onChange: (change: AssetOptionsValue) => void;
};

/**
 * The CSS class and the lazy loading of an asset, when the field has them.
 * The switch names lazy loading in plain words; the key stays `lazyLoading`.
 */
export function AssetOptionFields({
  value,
  enableCssClass,
  enableLazyLoading,
  disabled,
  onChange,
}: AssetOptionFieldsProps) {
  return (
    <>
      {enableCssClass && (
        <FieldWrapper label="CSS class">
          <StringInput
            code
            placeholder="rounded"
            value={value.cssClass ?? ''}
            onChange={(next) => onChange({ cssClass: next ?? '' })}
            disabled={disabled}
          />
        </FieldWrapper>
      )}
      {enableLazyLoading && (
        <FieldWrapper>
          <SwitchInput
            label="Load when scrolled into view"
            value={value.lazyLoading ?? false}
            onChange={(next) => onChange({ lazyLoading: Boolean(next) })}
            disabled={disabled}
          />
        </FieldWrapper>
      )}
    </>
  );
}
