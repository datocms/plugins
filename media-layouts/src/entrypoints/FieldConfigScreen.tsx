import type { RenderManualFieldExtensionConfigScreenCtx } from 'datocms-plugin-sdk';
import Callout from 'datocms-react-ui/Callout';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import InputGroup from 'datocms-react-ui/InputGroup';
import RadioGroupInput from 'datocms-react-ui/RadioGroupInput';
import SelectInput from 'datocms-react-ui/SelectInput';
import StringInput from 'datocms-react-ui/StringInput';
import SwitchInput from 'datocms-react-ui/SwitchInput';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import LayoutBuilder from '../components/LayoutBuilder';
import { DEFAULT_WIDTH, MODE_OPTIONS } from '../constants';
import type {
  FieldParams,
  FieldParamsLayout,
  FieldParamsLegacy,
  LayoutConfig,
  ValidFieldParams,
  WidthOption,
  WidthValue,
} from '../types';
import { validateCustomAspectRatio } from '../utils/aspectRatio';
import {
  createDefaultLayoutConfig,
  normalizeFieldParams,
  normalizeGlobalParams,
} from '../utils/fieldParams';
import {
  buildAspectRatioSelectOptions,
  buildWidthSelectOptions,
  CUSTOM_OPTION_VALUE,
  getAspectRatioShortLabel,
  isPresetAspectRatio,
  optionValueToWidth,
  PLUGIN_DEFAULT_OPTION_VALUE,
  type SelectOption,
  widthToOptionValue,
} from '../utils/options';
import {
  buildWidthOptions,
  getWidthLabel,
  parseCustomWidth,
  validateCustomWidth,
} from '../utils/width';

type Props = {
  ctx: RenderManualFieldExtensionConfigScreenCtx;
};

type LegacyModeValues = ValidFieldParams & { mode: 'single' | 'multiple' };

type UpdateLegacyMode = (
  field: 'mode' | 'aspectRatio' | 'width',
  value: string | number | null,
) => void;

const ASPECT_RATIO_SELECT_OPTIONS = buildAspectRatioSelectOptions({
  includeOriginal: true,
});

const STORED_MODES: unknown[] = ['single', 'multiple', 'layout'];

/** The parameters of a single or gallery field: no key for a plugin default. */
function toLegacyParameters(values: LegacyModeValues): FieldParamsLegacy {
  return {
    paramsVersion: '1',
    mode: values.mode,
    ...(values.aspectRatio !== null
      ? { overrideDefaultAspectRatio: values.aspectRatio }
      : {}),
    ...(values.width !== null ? { overrideDefaultWidth: values.width } : {}),
    enableCssClass: values.enableCssClass,
    enableLazyLoading: values.enableLazyLoading,
  };
}

/**
 * A new field stores no mode yet, while the screen shows Single asset
 * checked: a click on it changes nothing, and the field could not be saved.
 * Thus the screen stores what it shows, once, when it opens.
 */
function useStoreShownMode(
  ctx: Props['ctx'],
  formValues: ValidFieldParams,
): void {
  const checked = useRef(false);

  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    const storedMode = (ctx.parameters as Record<string, unknown>).mode;
    if (STORED_MODES.includes(storedMode) || formValues.mode === 'layout') {
      return;
    }
    ctx.setParameters(toLegacyParameters(formValues));
  }, [ctx, formValues]);
}

function useFieldConfigForm(ctx: Props['ctx']) {
  const [formValues, setFormValues] = useState<ValidFieldParams>(() =>
    normalizeFieldParams(ctx.parameters as FieldParams),
  );
  const [lastLayoutConfig, setLastLayoutConfig] = useState<LayoutConfig>(() =>
    formValues.mode === 'layout'
      ? formValues.layoutConfig
      : createDefaultLayoutConfig(),
  );

  useStoreShownMode(ctx, formValues);

  const updateLegacyMode = useCallback(
    (
      field: 'mode' | 'aspectRatio' | 'width',
      value: string | number | null,
    ) => {
      if (formValues.mode === 'layout') return;

      const newFormValues = {
        ...formValues,
        [field]: value,
      } as ValidFieldParams & {
        mode: 'single' | 'multiple';
      };
      setFormValues(newFormValues);
      ctx.setParameters(toLegacyParameters(newFormValues));
    },
    [formValues, ctx],
  );

  const updateLayoutConfig = useCallback(
    (layoutConfig: LayoutConfig) => {
      if (formValues.mode !== 'layout') return;

      const newFormValues: ValidFieldParams = {
        mode: 'layout',
        layoutConfig,
        enableCssClass: formValues.enableCssClass,
        enableLazyLoading: formValues.enableLazyLoading,
      };
      setFormValues(newFormValues);
      setLastLayoutConfig(layoutConfig);

      const newParameters: FieldParamsLayout = {
        paramsVersion: '2',
        mode: 'layout',
        layoutConfig,
        enableCssClass: newFormValues.enableCssClass,
        enableLazyLoading: newFormValues.enableLazyLoading,
      };

      ctx.setParameters(newParameters);
    },
    [formValues, ctx],
  );

  const updateFieldOption = useCallback(
    (field: 'enableCssClass' | 'enableLazyLoading', value: boolean) => {
      const newFormValues = {
        ...formValues,
        [field]: value,
      } as ValidFieldParams;
      setFormValues(newFormValues);

      if (newFormValues.mode === 'layout') {
        const newParameters: FieldParamsLayout = {
          paramsVersion: '2',
          mode: 'layout',
          layoutConfig: newFormValues.layoutConfig,
          enableCssClass: newFormValues.enableCssClass,
          enableLazyLoading: newFormValues.enableLazyLoading,
        };
        ctx.setParameters(newParameters);
        return;
      }

      ctx.setParameters(toLegacyParameters(newFormValues));
    },
    [formValues, ctx],
  );

  const handleModeChange = useCallback(
    (newMode: 'single' | 'multiple' | 'layout') => {
      if (newMode === 'layout') {
        const layoutConfig = lastLayoutConfig ?? createDefaultLayoutConfig();
        const newFormValues: ValidFieldParams = {
          mode: 'layout',
          layoutConfig,
          enableCssClass: formValues.enableCssClass,
          enableLazyLoading: formValues.enableLazyLoading,
        };
        setFormValues(newFormValues);

        const newParameters: FieldParamsLayout = {
          paramsVersion: '2',
          mode: 'layout',
          layoutConfig: newFormValues.layoutConfig,
          enableCssClass: newFormValues.enableCssClass,
          enableLazyLoading: newFormValues.enableLazyLoading,
        };
        ctx.setParameters(newParameters);
      } else {
        if (formValues.mode === 'layout') {
          setLastLayoutConfig(formValues.layoutConfig);
        }
        const newFormValues: ValidFieldParams = {
          mode: newMode,
          aspectRatio: null,
          width: null,
          enableCssClass: formValues.enableCssClass,
          enableLazyLoading: formValues.enableLazyLoading,
        };
        setFormValues(newFormValues);

        const newParameters: FieldParamsLegacy = {
          paramsVersion: '1',
          mode: newMode,
          enableCssClass: newFormValues.enableCssClass,
          enableLazyLoading: newFormValues.enableLazyLoading,
        };
        ctx.setParameters(newParameters);
      }
    },
    [ctx, formValues, lastLayoutConfig],
  );

  return {
    formValues,
    updateLegacyMode,
    updateLayoutConfig,
    updateFieldOption,
    handleModeChange,
  };
}

function useLegacyWidthState(
  legacyValues: LegacyModeValues | null,
  presetWidthValues: (string | number)[],
) {
  const isLegacyMode = legacyValues !== null;

  const isCustomWidthValue =
    isLegacyMode &&
    legacyValues.width !== null &&
    typeof legacyValues.width === 'number' &&
    !presetWidthValues.includes(legacyValues.width);

  const [customWidthActive, setCustomWidthActive] =
    useState(isCustomWidthValue);
  const [customWidthInput, setCustomWidthInput] = useState(
    isCustomWidthValue ? String(legacyValues?.width ?? '') : '',
  );

  useEffect(() => {
    if (!isLegacyMode || legacyValues?.width === null) {
      setCustomWidthActive(false);
      setCustomWidthInput('');
      return;
    }
    if (isCustomWidthValue) {
      setCustomWidthActive(true);
      setCustomWidthInput(String(legacyValues.width));
    }
  }, [isLegacyMode, legacyValues?.width, isCustomWidthValue]);

  return {
    customWidthActive,
    customWidthInput,
    setCustomWidthActive,
    setCustomWidthInput,
  };
}

function deriveCustomAspectRatioValue(
  legacyValues: LegacyModeValues | null,
  isCustomAspectRatio: boolean,
) {
  if (!legacyValues) return '';
  if (legacyValues.aspectRatio === 'custom') return '';
  if (isCustomAspectRatio) return legacyValues.aspectRatio ?? '';
  return '';
}

/**
 * The option of the stored override: the plugin default when there is none,
 * Custom for 'custom' or a ratio that is no preset.
 */
function deriveAspectRatioSelectValue(
  aspectRatio: string | null,
  isCustomAspectRatio: boolean,
): string {
  if (aspectRatio === null) return PLUGIN_DEFAULT_OPTION_VALUE;
  return isCustomAspectRatio ? CUSTOM_OPTION_VALUE : aspectRatio;
}

/** The width that picking Custom starts from. */
function deriveCustomWidthFallback(
  width: WidthValue | null,
  globalDefaultWidth: WidthValue,
): number {
  if (typeof width === 'number') return width;
  if (typeof globalDefaultWidth === 'number') return globalDefaultWidth;
  return DEFAULT_WIDTH;
}

export default function FieldConfigScreen({ ctx }: Props) {
  const pluginParameters = ctx.plugin.attributes.parameters;
  const globalParams = useMemo(
    () => normalizeGlobalParams(pluginParameters),
    [pluginParameters],
  );

  const {
    formValues,
    updateLegacyMode,
    updateLayoutConfig,
    updateFieldOption,
    handleModeChange,
  } = useFieldConfigForm(ctx);

  const presetWidthOptions = useMemo(
    () => buildWidthOptions(globalParams.widthPresets),
    [globalParams.widthPresets],
  );

  const legacyValues: LegacyModeValues | null =
    formValues.mode === 'layout' ? null : formValues;

  const errors = ctx.errors as Partial<Record<string, string>>;

  return (
    <>
      <FieldWrapper label="Mode" required error={errors.mode}>
        <RadioGroupInput
          options={MODE_OPTIONS}
          value={formValues.mode}
          onChange={(next) => {
            if (next !== null) handleModeChange(next);
          }}
        />
      </FieldWrapper>

      <FieldWrapper hint="Editors can give each asset a CSS class.">
        <SwitchInput
          label="CSS class for each asset"
          value={formValues.enableCssClass}
          onChange={(checked) =>
            updateFieldOption('enableCssClass', checked === true)
          }
        />
      </FieldWrapper>

      <FieldWrapper hint="Editors can choose whether each asset loads lazily.">
        <SwitchInput
          label="Lazy loading for each asset"
          value={formValues.enableLazyLoading}
          onChange={(checked) =>
            updateFieldOption('enableLazyLoading', checked === true)
          }
        />
      </FieldWrapper>

      {legacyValues && (
        <>
          <AspectRatioOverrideFields
            legacyValues={legacyValues}
            globalAspectRatio={globalParams.defaultAspectRatio}
            updateLegacyMode={updateLegacyMode}
          />
          <WidthOverrideFields
            legacyValues={legacyValues}
            globalDefaultWidth={globalParams.defaultWidth}
            presetWidthOptions={presetWidthOptions}
            error={errors.overrideDefaultWidth}
            updateLegacyMode={updateLegacyMode}
          />
        </>
      )}

      {formValues.mode === 'layout' && (
        <>
          {errors.layoutConfig && (
            <Callout tone="danger">{errors.layoutConfig}</Callout>
          )}
          <LayoutBuilder
            config={formValues.layoutConfig}
            onChange={updateLayoutConfig}
            widthOptions={presetWidthOptions}
            errors={errors}
          />
        </>
      )}
    </>
  );
}

type AspectRatioOverrideFieldsProps = {
  legacyValues: LegacyModeValues;
  globalAspectRatio: string;
  updateLegacyMode: UpdateLegacyMode;
};

/**
 * The default aspect ratio of the field. The plugin default option stores no
 * override; Custom stores the typed text, even while it is not valid.
 */
function AspectRatioOverrideFields({
  legacyValues,
  globalAspectRatio,
  updateLegacyMode,
}: AspectRatioOverrideFieldsProps) {
  const { aspectRatio } = legacyValues;
  const isCustomAspectRatio =
    aspectRatio !== null && !isPresetAspectRatio(aspectRatio);
  const customAspectRatioValue = deriveCustomAspectRatioValue(
    legacyValues,
    isCustomAspectRatio,
  );

  const options = useMemo<SelectOption[]>(
    () => [
      {
        value: PLUGIN_DEFAULT_OPTION_VALUE,
        label: `Plugin default: ${getAspectRatioShortLabel(globalAspectRatio)}`,
      },
      ...ASPECT_RATIO_SELECT_OPTIONS,
    ],
    [globalAspectRatio],
  );

  const handleSelectChange = (next: string | null) => {
    if (next === null) return;
    if (next === PLUGIN_DEFAULT_OPTION_VALUE) {
      updateLegacyMode('aspectRatio', null);
      return;
    }
    if (next === CUSTOM_OPTION_VALUE) {
      updateLegacyMode('aspectRatio', customAspectRatioValue || '');
      return;
    }
    updateLegacyMode('aspectRatio', next);
  };

  return (
    <>
      <FieldWrapper
        label="Default aspect ratio"
        hint="The crop of a new asset. Editors can change it for each asset."
      >
        <SelectInput
          value={deriveAspectRatioSelectValue(aspectRatio, isCustomAspectRatio)}
          onChange={handleSelectChange}
          options={options}
          clearable={false}
        />
      </FieldWrapper>
      {isCustomAspectRatio && (
        <FieldWrapper
          label="Custom aspect ratio"
          hint="Width and height, separated by a colon."
          error={validateCustomAspectRatio(customAspectRatioValue)}
        >
          <StringInput
            placeholder="2.35:1"
            value={customAspectRatioValue}
            onChange={(next) => updateLegacyMode('aspectRatio', next ?? '')}
          />
        </FieldWrapper>
      )}
    </>
  );
}

type WidthOverrideFieldsProps = {
  legacyValues: LegacyModeValues;
  globalDefaultWidth: WidthValue;
  presetWidthOptions: WidthOption[];
  error: string | undefined;
  updateLegacyMode: UpdateLegacyMode;
};

/**
 * The default width of the field. The plugin default option stores no
 * override; a typed custom width saves only when it is valid.
 */
function WidthOverrideFields({
  legacyValues,
  globalDefaultWidth,
  presetWidthOptions,
  error,
  updateLegacyMode,
}: WidthOverrideFieldsProps) {
  const presetWidthValues = useMemo(
    () => presetWidthOptions.map((opt) => opt.value),
    [presetWidthOptions],
  );
  const {
    customWidthActive,
    customWidthInput,
    setCustomWidthActive,
    setCustomWidthInput,
  } = useLegacyWidthState(legacyValues, presetWidthValues);

  const options = useMemo<SelectOption[]>(
    () => [
      {
        value: PLUGIN_DEFAULT_OPTION_VALUE,
        label: `Plugin default: ${getWidthLabel(globalDefaultWidth, presetWidthOptions)}`,
      },
      ...buildWidthSelectOptions(presetWidthOptions),
    ],
    [globalDefaultWidth, presetWidthOptions],
  );

  const { width } = legacyValues;
  const showsCustomWidth = width !== null && customWidthActive;
  const customWidthError = showsCustomWidth
    ? validateCustomWidth(customWidthInput)
    : undefined;

  const handleSelectChange = (next: string | null) => {
    if (next === null) return;
    if (next === PLUGIN_DEFAULT_OPTION_VALUE) {
      setCustomWidthActive(false);
      setCustomWidthInput('');
      updateLegacyMode('width', null);
      return;
    }
    if (next === CUSTOM_OPTION_VALUE) {
      const fallback = deriveCustomWidthFallback(width, globalDefaultWidth);
      setCustomWidthActive(true);
      setCustomWidthInput(String(fallback));
      updateLegacyMode('width', fallback);
      return;
    }
    setCustomWidthActive(false);
    setCustomWidthInput('');
    updateLegacyMode('width', optionValueToWidth(next));
  };

  const handleCustomWidthChange = (next: string | null) => {
    const text = next ?? '';
    setCustomWidthInput(text);
    const parsed = parseCustomWidth(text);
    if (parsed !== null && !validateCustomWidth(text)) {
      updateLegacyMode('width', parsed);
    }
  };

  let selectValue = PLUGIN_DEFAULT_OPTION_VALUE;
  if (width !== null) {
    selectValue = customWidthActive
      ? CUSTOM_OPTION_VALUE
      : widthToOptionValue(width);
  }

  return (
    <>
      <FieldWrapper
        label="Default width"
        hint="The width of a new asset. Editors can change it for each asset."
        // The custom width field below already tells what is wrong with it
        error={customWidthError ? undefined : error}
      >
        <SelectInput
          value={selectValue}
          onChange={handleSelectChange}
          options={options}
          clearable={false}
        />
      </FieldWrapper>
      {showsCustomWidth && (
        <FieldWrapper label="Custom width" error={customWidthError}>
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
