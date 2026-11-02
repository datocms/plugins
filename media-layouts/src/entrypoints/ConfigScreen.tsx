import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import InputGroup from 'datocms-react-ui/InputGroup';
import { Page } from 'datocms-react-ui/Page';
import SelectInput from 'datocms-react-ui/SelectInput';
import StringInput from 'datocms-react-ui/StringInput';
import TableList, {
  type TableListChange,
  type TableListColumn,
  type TableListRowTouched,
} from 'datocms-react-ui/TableList';
import { useMemo, useState } from 'react';
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
  type SelectOption,
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

/** Why the Save of a group is off, if it is */
function saveDisabledReason(dirty: boolean, invalidReason: string | false) {
  if (invalidReason) return { reason: invalidReason };
  if (!dirty) return { reason: 'There are no changes to save.' };
  return undefined;
}

/**
 * The plugin-wide settings, in two groups: the defaults of new assets and
 * the width presets. Each group keeps its changes until its Save.
 */
export default function ConfigScreen({ ctx }: Props) {
  const parameters = ctx.plugin.attributes.parameters;
  const saved = useMemo(() => normalizeGlobalParams(parameters), [parameters]);

  // Saves the changes of one group over the saved settings, then confirms
  const save = async (changes: Partial<ValidGlobalParams>) => {
    await ctx.updatePluginParameters({ ...saved, ...changes });
    ctx.notice('Settings saved.');
  };

  return (
    <Page>
      <Page.Content>
        <DefaultsGroup saved={saved} onSave={save} />
        <WidthPresetsGroup
          saved={saved.widthPresets}
          onSave={(widthPresets) => save({ widthPresets })}
        />
      </Page.Content>
    </Page>
  );
}

type DefaultsGroupProps = {
  saved: ValidGlobalParams;
  onSave: (
    changes: Pick<ValidGlobalParams, 'defaultAspectRatio' | 'defaultWidth'>,
  ) => Promise<void>;
};

/**
 * The aspect ratio and the width of new assets. A width that matches no
 * option (of the saved presets) shows as Custom, with its number.
 */
function DefaultsGroup({ saved, onSave }: DefaultsGroupProps) {
  const [aspectRatio, setAspectRatio] = useState(saved.defaultAspectRatio);
  const [width, setWidth] = useState<WidthValue>(saved.defaultWidth);
  // The text of the custom width input, once the user picked Custom or typed
  const [customWidthText, setCustomWidthText] = useState<string | null>(null);

  const widthOptions = useMemo(
    () => buildWidthOptions(saved.widthPresets),
    [saved.widthPresets],
  );
  const widthSelectOptions = useMemo(
    () => buildWidthSelectOptions(widthOptions),
    [widthOptions],
  );
  const widthMatchesNoOption =
    typeof width === 'number' &&
    !widthOptions.some((option) => option.value === width);
  const shownCustomWidth =
    customWidthText ?? (widthMatchesNoOption ? String(width) : null);

  const ratioError = isPresetAspectRatio(aspectRatio)
    ? undefined
    : validateCustomAspectRatio(customRatioText(aspectRatio));
  const widthError =
    shownCustomWidth === null
      ? undefined
      : validateCustomWidth(shownCustomWidth);
  const dirty =
    aspectRatio !== saved.defaultAspectRatio || width !== saved.defaultWidth;
  const invalidReason =
    ratioError && widthError
      ? 'Fix the errors above first.'
      : !!(ratioError || widthError) && 'Fix the error above first.';

  return (
    <Page.Group
      title="Default aspect ratio and width"
      footer={
        <Button
          tone="primary"
          label="Save"
          expand={false}
          disabled={saveDisabledReason(dirty, invalidReason)}
          onClick={() =>
            onSave({ defaultAspectRatio: aspectRatio, defaultWidth: width })
          }
        />
      }
    >
      <AspectRatioFields
        value={aspectRatio}
        error={ratioError}
        onChange={setAspectRatio}
      />
      <WidthFields
        value={width}
        customText={shownCustomWidth}
        error={widthError}
        options={widthSelectOptions}
        onChange={(nextWidth, nextCustomText) => {
          setWidth(nextWidth);
          setCustomWidthText(nextCustomText);
        }}
      />
    </Page.Group>
  );
}

/** The text of a custom aspect ratio: '' for 'custom', else the value. */
function customRatioText(value: string): string {
  return value === CUSTOM_OPTION_VALUE ? '' : value;
}

type AspectRatioFieldsProps = {
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
};

/**
 * The default aspect ratio. A value that is 'custom' or no preset shows as
 * Custom, with its text in the input below ('' for 'custom').
 */
function AspectRatioFields({ value, error, onChange }: AspectRatioFieldsProps) {
  const isCustom = !isPresetAspectRatio(value);
  const customText = isCustom ? customRatioText(value) : '';

  return (
    <>
      <FieldWrapper label="Aspect ratio">
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
        <FieldWrapper label="Custom aspect ratio" error={error}>
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
  /** The text of the custom width input, or null while it doesn't show */
  customText: string | null;
  error: string | undefined;
  options: SelectOption[];
  onChange: (value: WidthValue, customText: string | null) => void;
};

/**
 * The default width. Custom starts from the current number; a typed width
 * counts only when it is valid, while the input keeps the text.
 */
function WidthFields({
  value,
  customText,
  error,
  options,
  onChange,
}: WidthFieldsProps) {
  const handleSelectChange = (next: string | null) => {
    if (next === null) return;
    if (next === CUSTOM_OPTION_VALUE) {
      const fallback = typeof value === 'number' ? value : DEFAULT_WIDTH;
      onChange(fallback, String(fallback));
      return;
    }
    onChange(optionValueToWidth(next), null);
  };

  const handleCustomWidthChange = (next: string | null) => {
    const text = next ?? '';
    const parsed = parseCustomWidth(text);
    const valid = parsed !== null && !validateCustomWidth(text);
    onChange(valid ? parsed : value, text);
  };

  // The hint of the group, after its last field: the custom width, while it
  // shows
  const showsCustomWidth = customText !== null;
  const hint =
    'For assets that editors add to a field, unless the field sets its own.';

  return (
    <>
      <FieldWrapper label="Width" hint={showsCustomWidth ? undefined : hint}>
        <SelectInput
          value={
            showsCustomWidth ? CUSTOM_OPTION_VALUE : widthToOptionValue(value)
          }
          onChange={handleSelectChange}
          options={options}
          clearable={false}
        />
      </FieldWrapper>
      {showsCustomWidth && (
        <FieldWrapper label="Custom width" hint={hint} error={error}>
          <InputGroup
            value={customText}
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

const newPresetRow = (): PresetRow => ({ label: '', width: '' });

/**
 * The errors of a row. A width that an earlier row already has is an
 * error: the saved settings keep only the first preset of each width.
 */
function validatePresetRow(row: PresetRow, index: number, rows: PresetRow[]) {
  const width = row.width ?? '';
  const parsed = parseCustomWidth(width);
  const taken = rows
    .slice(0, index)
    .some((other) => parseCustomWidth(other.width ?? '') === parsed);
  return {
    label: (row.label ?? '').trim() ? undefined : 'Enter a label',
    width:
      validateCustomWidth(width) ??
      (taken ? 'Enter a width that no other preset has' : undefined),
  };
}

/** The preset of a row, or null while its label or width is not valid. */
function parsePresetRow(row: PresetRow): CustomWidthPreset | null {
  const label = (row.label ?? '').trim();
  const width = row.width ?? '';
  const parsed = parseCustomWidth(width);
  if (!label || validateCustomWidth(width) || parsed === null) return null;
  return { label, value: parsed };
}

function samePresets(
  a: (CustomWidthPreset | null)[],
  b: CustomWidthPreset[],
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (preset, i) =>
        preset?.label === b[i].label && preset?.value === b[i].value,
    )
  );
}

type WidthPresetsGroupProps = {
  saved: CustomWidthPreset[];
  onSave: (presets: CustomWidthPreset[]) => Promise<void>;
};

/**
 * The named widths. A new row starts empty; Save takes the rows once each
 * has a label and a valid width of its own.
 */
function WidthPresetsGroup({ saved, onSave }: WidthPresetsGroupProps) {
  const [rows, setRows] = useState<PresetRow[]>(() => saved.map(presetToRow));
  // The cells that the user left: their errors show, as in the TableList
  // docs (an empty new row has no error until then)
  const [touched, setTouched] = useState<(TableListRowTouched | undefined)[]>(
    [],
  );

  const columns = useMemo<TableListColumn<PresetRow>[]>(
    () => [
      { id: 'label', field: 'label', label: 'Label', grow: 2 },
      { id: 'width', field: 'width', label: 'Width in pixels' },
    ],
    [],
  );

  const errors = rows.map(validatePresetRow);
  const presets = rows.map(parsePresetRow);
  const invalid = errors.some((error) => error.label || error.width);

  const handleChange = (nextRows: PresetRow[], change: TableListChange) => {
    setRows(nextRows);
    if (change.type === 'remove') {
      setTouched((current) => current.filter((_, i) => i !== change.index));
    }
  };

  return (
    <Page.Group
      title="Width presets"
      footer={
        <Button
          tone="primary"
          label="Save"
          expand={false}
          disabled={saveDisabledReason(
            !samePresets(presets, saved),
            invalid && 'Give each preset a label and a width of its own.',
          )}
          onClick={() =>
            onSave(presets.flatMap((preset) => (preset ? [preset] : [])))
          }
        />
      }
    >
      <FieldWrapper
        label="Width presets"
        labelExtras={{ hidden: true }}
        hint="Named widths that every width menu shows, before the standard ones."
      >
        <TableList<PresetRow>
          value={rows}
          onChange={handleChange}
          errors={errors}
          touched={touched}
          onCellBlur={({ index, field }) =>
            setTouched((current) => {
              const next = [...current];
              const row = next[index];
              next[index] = {
                ...(typeof row === 'object' ? row : {}),
                [field]: true,
              };
              return next;
            })
          }
          columns={columns}
          emptyMessage="No width presets yet"
          add={{ label: 'Add preset', newItem: newPresetRow }}
        />
      </FieldWrapper>
    </Page.Group>
  );
}
