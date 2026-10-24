import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import InputGroup from 'datocms-react-ui/InputGroup';
import { Page } from 'datocms-react-ui/Page';
import SelectInput from 'datocms-react-ui/SelectInput';
import StringInput from 'datocms-react-ui/StringInput';
import TableList, {
  type TableListChange,
  type TableListColumn,
} from 'datocms-react-ui/TableList';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_WIDTH } from '../constants';
import type {
  CustomWidthPreset,
  ValidGlobalParams,
  WidthValue,
} from '../types';
import { validateCustomAspectRatio } from '../utils/aspectRatio';
import { normalizeGlobalParams } from '../utils/fieldParams';
import {
  buildAspectRatioSelectOptions,
  buildWidthSelectOptions,
  CUSTOM_OPTION_VALUE,
  isPresetAspectRatio,
  optionValueToWidth,
  widthToOptionValue,
} from '../utils/options';
import {
  buildWidthOptions,
  parseCustomWidth,
  validateCustomWidth,
} from '../utils/width';

type Props = {
  ctx: RenderConfigScreenCtx;
};

const ASPECT_RATIO_SELECT_OPTIONS = buildAspectRatioSelectOptions({
  includeOriginal: true,
});

/**
 * The plugin-wide defaults. There is no Save button: every change saves the
 * whole set of parameters at once.
 */
export default function ConfigScreen({ ctx }: Props) {
  const [formValues, setFormValues] = useState<ValidGlobalParams>(() =>
    normalizeGlobalParams(ctx.plugin.attributes.parameters),
  );

  const update = useCallback(
    <K extends keyof ValidGlobalParams>(
      field: K,
      value: ValidGlobalParams[K],
    ) => {
      const newParameters = { ...formValues, [field]: value };
      setFormValues(newParameters);
      ctx.updatePluginParameters(newParameters);
    },
    [formValues, ctx],
  );

  return (
    <Page>
      <Page.Content>
        <Page.Group title="Defaults for new assets">
          <AspectRatioFields
            value={formValues.defaultAspectRatio}
            onChange={(value) => update('defaultAspectRatio', value)}
          />
          <WidthFields
            value={formValues.defaultWidth}
            widthPresets={formValues.widthPresets}
            onChange={(value) => update('defaultWidth', value)}
          />
        </Page.Group>
        <Page.Group title="Width presets">
          <WidthPresetsField
            presets={formValues.widthPresets}
            onChange={(presets) => update('widthPresets', presets)}
          />
        </Page.Group>
      </Page.Content>
    </Page>
  );
}

type AspectRatioFieldsProps = {
  value: string;
  onChange: (value: string) => void;
};

/**
 * The default aspect ratio. A stored value that is 'custom' or no preset
 * shows as Custom, with its text in the input below ('' for 'custom'). Each
 * keystroke saves the text, also while it is not valid.
 */
function AspectRatioFields({ value, onChange }: AspectRatioFieldsProps) {
  const isCustom = !isPresetAspectRatio(value);
  const customText = isCustom && value !== CUSTOM_OPTION_VALUE ? value : '';

  return (
    <>
      <FieldWrapper
        label="Aspect ratio"
        hint="New assets get this crop unless their field sets its own."
      >
        <SelectInput
          value={isCustom ? CUSTOM_OPTION_VALUE : value}
          onChange={(next) => {
            if (next === null) return;
            onChange(next === CUSTOM_OPTION_VALUE ? customText : next);
          }}
          options={ASPECT_RATIO_SELECT_OPTIONS}
          clearable={false}
        />
      </FieldWrapper>
      {isCustom && (
        <FieldWrapper
          label="Custom aspect ratio"
          hint="Width and height, separated by a colon."
          error={validateCustomAspectRatio(customText)}
        >
          <StringInput
            placeholder="2.35:1"
            value={customText}
            onChange={(next) => onChange(next ?? '')}
          />
        </FieldWrapper>
      )}
    </>
  );
}

type WidthFieldsProps = {
  value: WidthValue;
  widthPresets: CustomWidthPreset[];
  onChange: (value: WidthValue) => void;
};

/**
 * The default width. A stored number that matches no option shows as
 * Custom; a typed width saves only when it is valid.
 */
function WidthFields({ value, widthPresets, onChange }: WidthFieldsProps) {
  const presetWidthOptions = useMemo(
    () => buildWidthOptions(widthPresets),
    [widthPresets],
  );
  const selectOptions = useMemo(
    () => buildWidthSelectOptions(presetWidthOptions),
    [presetWidthOptions],
  );
  const presetWidthValues = useMemo(
    () => presetWidthOptions.map((opt) => opt.value),
    [presetWidthOptions],
  );

  const isCustomWidthValue =
    typeof value === 'number' && !presetWidthValues.includes(value);
  const [customWidthActive, setCustomWidthActive] =
    useState(isCustomWidthValue);
  const [customWidthInput, setCustomWidthInput] = useState(
    isCustomWidthValue ? String(value) : '',
  );

  // Follows the saved width: a number that matches no option turns the
  // custom input on with that number, Original turns it off. A number that
  // matches an option leaves it as it is: picking Custom (or typing in it) a
  // width that an option also has keeps the custom input open. Picking an
  // option already turns it off.
  useEffect(() => {
    if (isCustomWidthValue) {
      setCustomWidthActive(true);
      setCustomWidthInput(String(value));
    } else if (value === 'original') {
      setCustomWidthActive(false);
      setCustomWidthInput('');
    }
  }, [value, isCustomWidthValue]);

  // Follows the presets: when an edit of the presets (not a typed width)
  // gives the saved width an option, the select shows that option.
  const previousWidthValues = useRef(presetWidthValues);
  useEffect(() => {
    const previous = previousWidthValues.current;
    previousWidthValues.current = presetWidthValues;
    if (previous === presetWidthValues) return;
    const matchedNoOption =
      typeof value === 'number' && !previous.includes(value);
    if (matchedNoOption && !isCustomWidthValue) {
      setCustomWidthActive(false);
      setCustomWidthInput('');
    }
  }, [presetWidthValues, value, isCustomWidthValue]);

  const handleSelectChange = (next: string | null) => {
    if (next === null) return;
    if (next === CUSTOM_OPTION_VALUE) {
      const fallback = typeof value === 'number' ? value : DEFAULT_WIDTH;
      setCustomWidthActive(true);
      setCustomWidthInput(String(fallback));
      onChange(fallback);
      return;
    }
    setCustomWidthActive(false);
    setCustomWidthInput('');
    onChange(optionValueToWidth(next));
  };

  const handleCustomWidthChange = (next: string | null) => {
    const text = next ?? '';
    setCustomWidthInput(text);
    const parsed = parseCustomWidth(text);
    if (parsed !== null && !validateCustomWidth(text)) {
      onChange(parsed);
    }
  };

  return (
    <>
      <FieldWrapper
        label="Width"
        hint="New assets get this width unless their field sets its own."
      >
        <SelectInput
          value={
            customWidthActive ? CUSTOM_OPTION_VALUE : widthToOptionValue(value)
          }
          onChange={handleSelectChange}
          options={selectOptions}
          clearable={false}
        />
      </FieldWrapper>
      {customWidthActive && (
        <FieldWrapper
          label="Custom width"
          error={validateCustomWidth(customWidthInput)}
        >
          <InputGroup
            value={customWidthInput}
            onChange={handleCustomWidthChange}
            post="px"
            inputMode="numeric"
            placeholder={String(DEFAULT_WIDTH)}
          />
        </FieldWrapper>
      )}
    </>
  );
}

type PresetRow = {
  label: string | null;
  width: string | null;
};

function presetToRow(preset: CustomWidthPreset): PresetRow {
  return { label: preset.label, width: String(preset.value) };
}

function validatePresetRow(row: PresetRow) {
  return {
    label: (row.label ?? '').trim() ? undefined : 'Enter a label',
    width: validateCustomWidth(row.width ?? ''),
  };
}

/** The preset of a row, or null while its label or width is not valid. */
function parsePresetRow(row: PresetRow | undefined): CustomWidthPreset | null {
  if (!row) return null;
  const label = (row.label ?? '').trim();
  const width = row.width ?? '';
  const parsed = parseCustomWidth(width);
  if (!label || validateCustomWidth(width) || parsed === null) return null;
  return { label, value: parsed };
}

type WidthPresetsFieldProps = {
  presets: CustomWidthPreset[];
  onChange: (presets: CustomWidthPreset[]) => void;
};

/**
 * The named widths. The rows keep what the user types; the saved preset at
 * an index changes only when its row is valid. Rows and saved presets stay
 * in step by index: an add or a remove changes both.
 */
function WidthPresetsField({ presets, onChange }: WidthPresetsFieldProps) {
  // Taken from the saved presets once: a later save never resets the rows,
  // so a row that is not valid yet keeps its text
  const [rows, setRows] = useState<PresetRow[]>(() => presets.map(presetToRow));

  const columns = useMemo<TableListColumn<PresetRow>[]>(
    () => [
      { id: 'label', field: 'label', label: 'Label', grow: 2 },
      { id: 'width', field: 'width', label: 'Width in pixels' },
    ],
    [],
  );

  const errors = rows.map(validatePresetRow);
  const nextLabel = `Preset ${presets.length + 1}`;

  const handleChange = (nextRows: PresetRow[], change: TableListChange) => {
    setRows(nextRows);

    if (change.type === 'add') {
      onChange([...presets, { label: nextLabel, value: DEFAULT_WIDTH }]);
      return;
    }

    if (change.type === 'remove') {
      onChange(presets.filter((_preset, i) => i !== change.index));
      return;
    }

    if (change.type === 'edit') {
      const edited = parsePresetRow(nextRows[change.index]);
      if (!edited) return;
      onChange(
        presets.map((preset, i) =>
          i === change.index ? { ...preset, ...edited } : preset,
        ),
      );
    }
  };

  return (
    <FieldWrapper
      label="Width presets"
      labelExtras={{ hidden: true }}
      hint="Named widths that every width menu shows, before the standard ones."
    >
      <TableList<PresetRow>
        value={rows}
        onChange={handleChange}
        errors={errors}
        // Errors show at once, not after the user leaves a cell
        touched={true}
        columns={columns}
        emptyMessage="No width presets yet"
        add={{
          label: 'Add preset',
          newItem: () => ({ label: nextLabel, width: String(DEFAULT_WIDTH) }),
        }}
      />
    </FieldWrapper>
  );
}
