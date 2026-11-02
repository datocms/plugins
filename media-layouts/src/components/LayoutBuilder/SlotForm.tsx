import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import InputGroup from 'datocms-react-ui/InputGroup';
import RadioGroupInput, {
  type RadioGroupOption,
} from 'datocms-react-ui/RadioGroupInput';
import SelectInput from 'datocms-react-ui/SelectInput';
import StringInput from 'datocms-react-ui/StringInput';
import SwitchInput from 'datocms-react-ui/SwitchInput';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ASPECT_RATIO_OPTIONS,
  COLUMN_OPTIONS,
  DEFAULT_WIDTH,
  ROW_OPTIONS,
} from '../../constants';
import type { LayoutConfig, LayoutSlot, WidthOption } from '../../types';
import { validateCustomAspectRatio } from '../../utils/aspectRatio';
import {
  buildAspectRatioSelectOptions,
  buildWidthSelectOptions,
  CUSTOM_OPTION_VALUE,
  type SelectOption,
  widthToOptionValue,
} from '../../utils/options';
import { parseCustomWidth, validateCustomWidth } from '../../utils/width';
import {
  computeSpanOptions,
  deriveSlotAspectRatioSelectValue,
  deriveSlotAspectRatioValue,
  type SpanOptions,
} from './grid';

const ASPECT_RATIO_SELECT_OPTIONS = buildAspectRatioSelectOptions({
  includeOriginal: true,
});

const PRESET_ASPECT_RATIO_VALUES = ASPECT_RATIO_OPTIONS.filter(
  (opt) => opt.value !== CUSTOM_OPTION_VALUE,
).map((opt) => opt.value);

export type UpdateSlot = (slotId: string, updates: Partial<LayoutSlot>) => void;

type UseSlotWidthControlsArgs = {
  selectedSlot: LayoutSlot | null | undefined;
  presetWidthValues: Set<string | number>;
  handleUpdateSlot: UpdateSlot;
};

function useSlotWidthControls({
  selectedSlot,
  presetWidthValues,
  handleUpdateSlot,
}: UseSlotWidthControlsArgs) {
  const slotWidthIsCustomValue =
    !!selectedSlot &&
    typeof selectedSlot.width === 'number' &&
    !presetWidthValues.has(selectedSlot.width);

  const [slotCustomWidthActive, setSlotCustomWidthActive] = useState(
    slotWidthIsCustomValue,
  );
  const [slotCustomWidthInput, setSlotCustomWidthInput] = useState(
    slotWidthIsCustomValue ? String(selectedSlot?.width ?? '') : '',
  );

  const previousSelectedSlotId = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedSlot) {
      previousSelectedSlotId.current = null;
      setSlotCustomWidthActive(false);
      setSlotCustomWidthInput('');
      return;
    }

    const slotChanged = previousSelectedSlotId.current !== selectedSlot.id;
    previousSelectedSlotId.current = selectedSlot.id;
    const widthIsCustom =
      typeof selectedSlot.width === 'number' &&
      !presetWidthValues.has(selectedSlot.width);

    if (widthIsCustom) {
      setSlotCustomWidthActive(true);
      setSlotCustomWidthInput(String(selectedSlot.width));
      return;
    }

    if (slotChanged || selectedSlot.width === 'original') {
      setSlotCustomWidthActive(false);
      setSlotCustomWidthInput('');
    }
  }, [presetWidthValues, selectedSlot]);

  const slotCustomWidthError = slotCustomWidthActive
    ? validateCustomWidth(slotCustomWidthInput)
    : undefined;

  const handleSlotWidthSelectChange = useCallback(
    (slotId: string, value: string, currentWidth: LayoutSlot['width']) => {
      if (value === CUSTOM_OPTION_VALUE) {
        const fallback =
          typeof currentWidth === 'number' ? currentWidth : DEFAULT_WIDTH;
        setSlotCustomWidthActive(true);
        setSlotCustomWidthInput(String(fallback));
        handleUpdateSlot(slotId, { width: fallback });
        return;
      }
      setSlotCustomWidthActive(false);
      setSlotCustomWidthInput('');
      handleUpdateSlot(slotId, {
        width: value === 'original' ? 'original' : Number(value),
      });
    },
    [handleUpdateSlot],
  );

  const handleSlotCustomWidthInputChange = useCallback(
    (slotId: string, value: string) => {
      setSlotCustomWidthInput(value);
      const parsed = parseCustomWidth(value);
      if (parsed !== null && !validateCustomWidth(value)) {
        handleUpdateSlot(slotId, { width: parsed });
      }
    },
    [handleUpdateSlot],
  );

  return {
    slotCustomWidthActive,
    slotCustomWidthInput,
    slotCustomWidthError,
    handleSlotWidthSelectChange,
    handleSlotCustomWidthInputChange,
  };
}

// Every row span of a grid of more rows than radios take
function toRowSpanSelectOptions(max: number): SelectOption[] {
  return ROW_OPTIONS.slice(0, max).map((option) => ({
    value: String(option.value),
    label: option.label,
  }));
}

// Up to five spans to compare are radios; more are a select
const MAX_SPAN_RADIOS = 5;

const NO_ROOM_REASON = "There's no room for this span.";

// The select can't say why an option is off: its field does
const NO_ROOM_FOR_LONGER_SPANS = "There's no room for the longer spans.";

/**
 * Every span from 1 to the size of the grid. The spans that don't fit are
 * disabled, with the reason; the current span is always on.
 */
function toSpanRadioOptions({
  spans,
  max,
  fitting,
  current,
}: {
  /** The spans with their labels: COLUMN_OPTIONS or ROW_OPTIONS */
  spans: readonly { value: number; label: string }[];
  max: number;
  fitting: number[];
  current: number;
}): RadioGroupOption[] {
  return spans.slice(0, max).map(({ value: span, label }) => {
    if (span === current || fitting.includes(span)) {
      return { value: String(span), label };
    }
    return {
      value: String(span),
      label,
      disabled: true,
      tooltip: NO_ROOM_REASON,
    };
  });
}

type SlotFieldProps = {
  slot: LayoutSlot;
  onUpdateSlot: UpdateSlot;
};

/**
 * The aspect ratio controls of a slot. Custom starts from the stored ratio
 * (or the custom text), and the custom input saves each keystroke, valid or
 * not.
 */
function slotAspectRatioControls({ slot, onUpdateSlot }: SlotFieldProps) {
  const selectValue = deriveSlotAspectRatioSelectValue(
    slot,
    PRESET_ASPECT_RATIO_VALUES,
  );
  const isCustom = selectValue === CUSTOM_OPTION_VALUE;
  const customAspectRatio = isCustom ? deriveSlotAspectRatioValue(slot) : '';

  const handleSelectChange = (next: string | null) => {
    if (next === null) return;
    if (next === CUSTOM_OPTION_VALUE) {
      const existingCustomValue = deriveSlotAspectRatioValue(slot);
      onUpdateSlot(slot.id, {
        aspectRatio: CUSTOM_OPTION_VALUE,
        customAspectRatio: existingCustomValue || '',
      });
      return;
    }
    onUpdateSlot(slot.id, { aspectRatio: next, customAspectRatio: undefined });
  };

  const handleCustomChange = (next: string | null) =>
    onUpdateSlot(slot.id, {
      aspectRatio: CUSTOM_OPTION_VALUE,
      customAspectRatio: next ?? '',
    });

  return {
    selectValue,
    isCustom,
    customAspectRatio,
    handleSelectChange,
    handleCustomChange,
  };
}

/**
 * The aspect ratio and the width of a slot, side by side. Custom shows its
 * input under its own menu, in the same cell (as the crop fields of an
 * asset do). A stored width that matches no option shows as Custom; a typed
 * width saves only when it is valid, while the input keeps the text.
 */
function SlotCropFields({
  slot,
  widthOptions,
  onUpdateSlot,
}: SlotFieldProps & { widthOptions: WidthOption[] }) {
  const presetWidthValues = useMemo(
    () => new Set(widthOptions.map((opt) => opt.value)),
    [widthOptions],
  );
  const widthSelectOptions = useMemo(
    () => buildWidthSelectOptions(widthOptions),
    [widthOptions],
  );
  const ratio = slotAspectRatioControls({ slot, onUpdateSlot });
  const width = useSlotWidthControls({
    selectedSlot: slot,
    presetWidthValues,
    handleUpdateSlot: onUpdateSlot,
  });

  return (
    <div className="form__field form__row">
      <div className="form__row__cell">
        <FieldWrapper label="Aspect ratio">
          <SelectInput
            value={ratio.selectValue}
            onChange={ratio.handleSelectChange}
            options={ASPECT_RATIO_SELECT_OPTIONS}
            clearable={false}
          />
        </FieldWrapper>
        {ratio.isCustom && (
          <FieldWrapper
            label="Custom aspect ratio"
            error={validateCustomAspectRatio(ratio.customAspectRatio)}
          >
            <StringInput
              placeholder="2.35:1"
              value={ratio.customAspectRatio}
              onChange={ratio.handleCustomChange}
            />
          </FieldWrapper>
        )}
      </div>
      <div className="form__row__cell">
        <FieldWrapper label="Width">
          <SelectInput
            value={
              width.slotCustomWidthActive
                ? CUSTOM_OPTION_VALUE
                : widthToOptionValue(slot.width)
            }
            onChange={(next) => {
              if (next !== null) {
                width.handleSlotWidthSelectChange(slot.id, next, slot.width);
              }
            }}
            options={widthSelectOptions}
            clearable={false}
          />
        </FieldWrapper>
        {width.slotCustomWidthActive && (
          <FieldWrapper label="Custom width" error={width.slotCustomWidthError}>
            <InputGroup
              value={width.slotCustomWidthInput}
              onChange={(next) =>
                width.handleSlotCustomWidthInputChange(slot.id, next ?? '')
              }
              post="px"
              inputMode="numeric"
              placeholder={String(DEFAULT_WIDTH)}
            />
          </FieldWrapper>
        )}
      </div>
    </div>
  );
}

type SpanFieldProps = SlotFieldProps & {
  config: LayoutConfig;
  spanOptions: SpanOptions;
  hint: string | undefined;
  error: string | undefined;
};

/** The columns that a slot spans, as radios (a layout has four at most). */
function ColSpanField({
  config,
  slot,
  spanOptions,
  hint,
  error,
  onUpdateSlot,
}: SpanFieldProps) {
  return (
    <FieldWrapper label="Column span" hint={hint} error={error}>
      <RadioGroupInput
        small
        value={String(spanOptions.colSpan)}
        onChange={(next) => {
          if (next !== null) onUpdateSlot(slot.id, { colSpan: Number(next) });
        }}
        options={toSpanRadioOptions({
          spans: COLUMN_OPTIONS,
          max: config.columns,
          fitting: spanOptions.colOptions,
          current: spanOptions.colSpan,
        })}
      />
    </FieldWrapper>
  );
}

/**
 * The rows that a grid slot spans, from 1 to the rows of the grid: radios up
 * to five rows, a select for more. The spans that don't fit are disabled
 * (the current span is always on); the select, whose options can't carry a
 * reason, says it in the hint of the field.
 */
function RowSpanField({
  config,
  slot,
  spanOptions,
  hint,
  error,
  onUpdateSlot,
}: SpanFieldProps) {
  const handleChange = (next: string | null) => {
    if (next !== null) onUpdateSlot(slot.id, { rowSpan: Number(next) });
  };

  if (config.rows > MAX_SPAN_RADIOS) {
    const options = toRowSpanSelectOptions(config.rows);
    const enabled = new Set(
      [spanOptions.rowSpan, ...spanOptions.rowOptions].map(String),
    );
    const someOff = options.some((option) => !enabled.has(option.value));
    return (
      <FieldWrapper
        label="Row span"
        hint={hint ?? (someOff ? NO_ROOM_FOR_LONGER_SPANS : undefined)}
        error={error}
      >
        <SelectInput
          value={String(spanOptions.rowSpan)}
          onChange={handleChange}
          options={options}
          isOptionDisabled={(option) => !enabled.has(option.value)}
          clearable={false}
        />
      </FieldWrapper>
    );
  }

  return (
    <FieldWrapper label="Row span" hint={hint} error={error}>
      <RadioGroupInput
        small
        value={String(spanOptions.rowSpan)}
        onChange={handleChange}
        options={toSpanRadioOptions({
          spans: ROW_OPTIONS,
          max: config.rows,
          fitting: spanOptions.rowOptions,
          current: spanOptions.rowSpan,
        })}
      />
    </FieldWrapper>
  );
}

const LARGER_SPAN_HINT =
  'Add rows or columns, or remove a slot, to make this slot larger.';

const AUTO_SPAN_HINT =
  'The slot spans the cells that best match its aspect ratio.';

type SpanFieldsLayout = {
  showColSpan: boolean;
  showRowSpan: boolean;
  /** The hint about larger spans, when only a span of one cell fits */
  largerSpanHint: string | undefined;
};

/**
 * Which span fields show. A layout of one column (or of one row) has no
 * span to pick there: that field shows only for its error.
 */
function spanFieldsLayout({
  config,
  isMasonry,
  spanOptions,
  colSpanError,
  rowSpanError,
}: {
  config: LayoutConfig;
  isMasonry: boolean;
  spanOptions: SpanOptions;
  colSpanError: string | undefined;
  rowSpanError: string | undefined;
}): SpanFieldsLayout {
  const onlySmallestFits =
    !isMasonry &&
    spanOptions.rowOptions.length === 1 &&
    spanOptions.colOptions.length === 1;
  return {
    showColSpan: config.columns > 1 || !!colSpanError,
    showRowSpan: !isMasonry && (config.rows > 1 || !!rowSpanError),
    largerSpanHint: onlySmallestFits ? LARGER_SPAN_HINT : undefined,
  };
}

type SlotSpanFieldsProps = SlotFieldProps & {
  config: LayoutConfig;
  spanOptions: SpanOptions;
  layout: SpanFieldsLayout;
  colSpanError: string | undefined;
  rowSpanError: string | undefined;
};

/**
 * The cells that the slot spans. In a grid, the spans that don't fit next
 * to the other slots are disabled; in masonry, only the columns. The hint
 * about larger spans goes on the first field that shows (with no span
 * field, the slot form puts it on the automatic span).
 */
function SlotSpanFields({
  config,
  slot,
  spanOptions,
  layout,
  colSpanError,
  rowSpanError,
  onUpdateSlot,
}: SlotSpanFieldsProps) {
  const { showColSpan, showRowSpan, largerSpanHint } = layout;
  const fieldProps = { config, slot, spanOptions, onUpdateSlot };

  if (!showColSpan && !showRowSpan) return null;

  // One cell for each field that shows: a lone field takes the whole row
  return (
    <div className="form__field form__row">
      {showColSpan && (
        <div className="form__row__cell">
          <ColSpanField
            {...fieldProps}
            hint={largerSpanHint}
            error={colSpanError}
          />
        </div>
      )}
      {showRowSpan && (
        <div className="form__row__cell">
          <RowSpanField
            {...fieldProps}
            hint={showColSpan ? undefined : largerSpanHint}
            error={rowSpanError}
          />
        </div>
      )}
    </div>
  );
}

type SlotFormProps = {
  config: LayoutConfig;
  slot: LayoutSlot;
  /** The position of the slot in the slots of the layout */
  index: number;
  isMasonry: boolean;
  widthOptions: WidthOption[];
  errors: Partial<Record<string, string>>;
  onUpdateSlot: UpdateSlot;
};

/**
 * The settings of one slot, in its item of the slot list. Every change goes
 * through `onUpdateSlot`, which keeps the rules of the automatic span.
 */
export default function SlotForm({
  config,
  slot,
  index,
  isMasonry,
  widthOptions,
  errors,
  onUpdateSlot,
}: SlotFormProps) {
  const labelError = (slot.label ?? '').trim()
    ? errors[`slot_${index}_label`]
    : 'Enter a label';
  const colSpanError = errors[`slot_${index}_colSpan`];
  const rowSpanError = errors[`slot_${index}_rowSpan`];
  const spanOptions = useMemo(
    () => computeSpanOptions(slot, isMasonry, config),
    [config, isMasonry, slot],
  );
  const spanLayout = spanFieldsLayout({
    config,
    isMasonry,
    spanOptions,
    colSpanError,
    rowSpanError,
  });
  // A grid of one cell has no span field for the hint about larger spans:
  // it goes on the automatic span, where the old panel had it
  const noSpanField = !spanLayout.showColSpan && !spanLayout.showRowSpan;
  const autoSpanHint =
    noSpanField && spanLayout.largerSpanHint
      ? `${AUTO_SPAN_HINT} ${spanLayout.largerSpanHint}`
      : AUTO_SPAN_HINT;

  return (
    <>
      <FieldWrapper label="Label" required error={labelError}>
        <StringInput
          placeholder="Team photo"
          value={slot.label}
          onChange={(next) => onUpdateSlot(slot.id, { label: next ?? '' })}
        />
      </FieldWrapper>

      <SlotCropFields
        slot={slot}
        widthOptions={widthOptions}
        onUpdateSlot={onUpdateSlot}
      />

      <SlotSpanFields
        config={config}
        slot={slot}
        spanOptions={spanOptions}
        layout={spanLayout}
        colSpanError={colSpanError}
        rowSpanError={rowSpanError}
        onUpdateSlot={onUpdateSlot}
      />

      {!isMasonry && (
        <FieldWrapper
          hint={autoSpanHint}
          error={errors[`slot_${index}_autoSpan`]}
        >
          <SwitchInput
            label="Size from aspect ratio"
            value={slot.autoSpan ?? false}
            onChange={(next) =>
              onUpdateSlot(slot.id, { autoSpan: next === true })
            }
          />
        </FieldWrapper>
      )}

      <FieldWrapper hint="Editors see that this slot needs an asset.">
        <SwitchInput
          label="Required"
          value={slot.required}
          onChange={(next) =>
            onUpdateSlot(slot.id, { required: next === true })
          }
        />
      </FieldWrapper>
    </>
  );
}
