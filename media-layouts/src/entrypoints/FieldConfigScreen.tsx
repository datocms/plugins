import type { RenderManualFieldExtensionConfigScreenCtx } from 'datocms-plugin-sdk';
import {
  Canvas,
  Form,
  SelectField,
  SwitchField,
  TextField,
} from 'datocms-react-ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import LayoutBuilder from '../components/LayoutBuilder';
import {
  ASPECT_RATIO_OPTIONS,
  DEFAULT_WIDTH,
  MODE_OPTIONS,
} from '../constants';
import type {
  FieldParams,
  FieldParamsLayout,
  FieldParamsLegacy,
  LayoutConfig,
  ValidFieldParams,
  ValidGlobalParams,
  WidthOption,
} from '../types';
import { validateCustomAspectRatio } from '../utils/aspectRatio';
import {
  createDefaultLayoutConfig,
  normalizeFieldParams,
  normalizeGlobalParams,
} from '../utils/fieldParams';
import {
  buildWidthOptions,
  getWidthLabel,
  MAX_WIDTH,
  MIN_WIDTH,
  parseCustomWidth,
  validateCustomWidth,
} from '../utils/width';
import styles from './FieldConfigScreen.module.css';

type Props = {
  ctx: RenderManualFieldExtensionConfigScreenCtx;
};

const modeSelectOptions = MODE_OPTIONS.map((opt) => ({
  value: opt.value,
  label: opt.label,
}));

type LegacyModeValues = ValidFieldParams & { mode: 'single' | 'multiple' };

type LegacyAspectRatioSectionProps = {
  legacyValues: LegacyModeValues;
  globalParams: ValidGlobalParams;
  aspectRatioOptions: { value: string; label: string }[];
  selectedAspectRatio: { value: string; label: string } | null | undefined;
  isCustomAspectRatio: boolean;
  customAspectRatioValue: string;
  customAspectRatioError: string | undefined;
  updateLegacyMode: (
    field: 'mode' | 'aspectRatio' | 'width',
    value: string | number | null,
  ) => void;
};

function LegacyAspectRatioSection({
  legacyValues,
  globalParams,
  aspectRatioOptions,
  selectedAspectRatio,
  isCustomAspectRatio,
  customAspectRatioValue,
  customAspectRatioError,
  updateLegacyMode,
}: LegacyAspectRatioSectionProps) {
  function handleAspectRatioChange(
    option: { value: string; label: string } | null,
  ) {
    if (!option || !('value' in option)) return;
    if (option.value === 'custom') {
      updateLegacyMode('aspectRatio', customAspectRatioValue || '');
    } else {
      updateLegacyMode('aspectRatio', option.value);
    }
  }

  return (
    <>
      <div className={styles.fieldBlock}>
        <SwitchField
          id="useDefaultAspectRatio"
          name="useDefaultAspectRatio"
          label="Use global default aspect ratio?"
          hint={`Global default: ${globalParams.defaultAspectRatio}`}
          value={legacyValues.aspectRatio === null}
          onChange={(checked) =>
            updateLegacyMode(
              'aspectRatio',
              checked ? null : globalParams.defaultAspectRatio,
            )
          }
        />
      </div>

      {legacyValues.aspectRatio !== null && (
        <div className={styles.fieldBlock}>
          <SelectField
            id="aspectRatio"
            name="aspectRatio"
            label="Override default aspect ratio"
            selectInputProps={{
              options: aspectRatioOptions,
            }}
            value={selectedAspectRatio}
            onChange={handleAspectRatioChange}
          />
        </div>
      )}

      {isCustomAspectRatio && (
        <div className={styles.fieldBlock}>
          <TextField
            id="customAspectRatio"
            name="customAspectRatio"
            label="Custom Aspect Ratio"
            hint="Use W:H (e.g., 2.35:1)"
            placeholder="2.35:1"
            value={customAspectRatioValue}
            onChange={(value) => updateLegacyMode('aspectRatio', value)}
            error={customAspectRatioError}
          />
        </div>
      )}
    </>
  );
}

type LegacyWidthSectionProps = {
  legacyValues: LegacyModeValues;
  globalParams: ValidGlobalParams;
  widthOptions: { value: string | number; label: string }[];
  selectedWidth: { value: string | number; label: string } | null | undefined;
  presetWidthOptions: WidthOption[];
  presetWidthValues: (string | number)[];
  customWidthActive: boolean;
  customWidthInput: string;
  customWidthError: string | undefined;
  setCustomWidthActive: (value: boolean) => void;
  setCustomWidthInput: (value: string) => void;
  updateLegacyMode: (
    field: 'mode' | 'aspectRatio' | 'width',
    value: string | number | null,
  ) => void;
};

function LegacyWidthSection({
  legacyValues,
  globalParams,
  widthOptions,
  selectedWidth,
  presetWidthOptions,
  presetWidthValues,
  customWidthActive,
  customWidthInput,
  customWidthError,
  setCustomWidthActive,
  setCustomWidthInput,
  updateLegacyMode,
}: LegacyWidthSectionProps) {
  function handleWidthSelectChange(
    option: { value: string | number; label: string } | null,
  ) {
    if (!option || !('value' in option)) return;
    if (option.value === 'custom') {
      const fallback =
        typeof legacyValues.width === 'number'
          ? legacyValues.width
          : typeof globalParams.defaultWidth === 'number'
            ? globalParams.defaultWidth
            : DEFAULT_WIDTH;
      setCustomWidthActive(true);
      setCustomWidthInput(String(fallback));
      updateLegacyMode('width', fallback);
    } else {
      setCustomWidthActive(false);
      setCustomWidthInput('');
      updateLegacyMode('width', option.value);
    }
  }

  function handleUseDefaultWidthChange(checked: boolean) {
    const nextWidth = checked ? null : globalParams.defaultWidth;
    updateLegacyMode('width', nextWidth);
    const isPresetValue =
      typeof nextWidth === 'number' && presetWidthValues.includes(nextWidth);
    const shouldShowCustom =
      !checked &&
      nextWidth !== null &&
      nextWidth !== 'original' &&
      !isPresetValue;
    if (shouldShowCustom && typeof nextWidth === 'number') {
      setCustomWidthActive(true);
      setCustomWidthInput(String(nextWidth));
    } else {
      setCustomWidthActive(false);
      setCustomWidthInput('');
    }
  }

  function handleCustomWidthChange(value: string) {
    setCustomWidthInput(value);
    const parsed = parseCustomWidth(value);
    if (parsed !== null && !validateCustomWidth(value)) {
      updateLegacyMode('width', parsed);
    }
  }

  return (
    <>
      <div className={styles.fieldBlock}>
        <SwitchField
          id="useDefaultWidth"
          name="useDefaultWidth"
          label="Use global default width?"
          hint={`Global default: ${getWidthLabel(globalParams.defaultWidth, presetWidthOptions)}`}
          value={legacyValues.width === null}
          onChange={handleUseDefaultWidthChange}
        />
      </div>

      {legacyValues.width !== null && (
        <div className={styles.fieldBlock}>
          <SelectField
            id="width"
            name="width"
            label="Override default width"
            selectInputProps={{
              options: widthOptions,
            }}
            value={selectedWidth}
            onChange={handleWidthSelectChange}
          />
        </div>
      )}

      {legacyValues.width !== null && customWidthActive && (
        <div className={styles.fieldBlock}>
          <TextField
            id="customWidth"
            name="customWidth"
            label="Custom Width"
            hint={`Pixels (${MIN_WIDTH}–${MAX_WIDTH})`}
            placeholder={String(DEFAULT_WIDTH)}
            value={customWidthInput}
            onChange={handleCustomWidthChange}
            error={customWidthError}
            textInputProps={{
              type: 'number',
              min: MIN_WIDTH,
              max: MAX_WIDTH,
            }}
          />
        </div>
      )}
    </>
  );
}

type LegacyModeFieldsProps = {
  legacyValues: LegacyModeValues;
  globalParams: ValidGlobalParams;
  aspectRatioOptions: { value: string; label: string }[];
  selectedAspectRatio: { value: string; label: string } | null | undefined;
  isCustomAspectRatio: boolean;
  customAspectRatioValue: string;
  customAspectRatioError: string | undefined;
  widthOptions: { value: string | number; label: string }[];
  selectedWidth: { value: string | number; label: string } | null | undefined;
  presetWidthOptions: WidthOption[];
  presetWidthValues: (string | number)[];
  customWidthActive: boolean;
  customWidthInput: string;
  customWidthError: string | undefined;
  setCustomWidthActive: (value: boolean) => void;
  setCustomWidthInput: (value: string) => void;
  updateLegacyMode: (
    field: 'mode' | 'aspectRatio' | 'width',
    value: string | number | null,
  ) => void;
};

function LegacyModeFields({
  legacyValues,
  globalParams,
  aspectRatioOptions,
  selectedAspectRatio,
  isCustomAspectRatio,
  customAspectRatioValue,
  customAspectRatioError,
  widthOptions,
  selectedWidth,
  presetWidthOptions,
  presetWidthValues,
  customWidthActive,
  customWidthInput,
  customWidthError,
  setCustomWidthActive,
  setCustomWidthInput,
  updateLegacyMode,
}: LegacyModeFieldsProps) {
  return (
    <>
      <LegacyAspectRatioSection
        legacyValues={legacyValues}
        globalParams={globalParams}
        aspectRatioOptions={aspectRatioOptions}
        selectedAspectRatio={selectedAspectRatio}
        isCustomAspectRatio={isCustomAspectRatio}
        customAspectRatioValue={customAspectRatioValue}
        customAspectRatioError={customAspectRatioError}
        updateLegacyMode={updateLegacyMode}
      />
      <LegacyWidthSection
        legacyValues={legacyValues}
        globalParams={globalParams}
        widthOptions={widthOptions}
        selectedWidth={selectedWidth}
        presetWidthOptions={presetWidthOptions}
        presetWidthValues={presetWidthValues}
        customWidthActive={customWidthActive}
        customWidthInput={customWidthInput}
        customWidthError={customWidthError}
        setCustomWidthActive={setCustomWidthActive}
        setCustomWidthInput={setCustomWidthInput}
        updateLegacyMode={updateLegacyMode}
      />
    </>
  );
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

      const newParameters: FieldParamsLegacy = {
        paramsVersion: '1',
        mode: newFormValues.mode,
        ...(newFormValues.aspectRatio !== null
          ? { overrideDefaultAspectRatio: newFormValues.aspectRatio }
          : {}),
        ...(newFormValues.width !== null
          ? { overrideDefaultWidth: newFormValues.width }
          : {}),
        enableCssClass: newFormValues.enableCssClass,
        enableLazyLoading: newFormValues.enableLazyLoading,
      };

      ctx.setParameters(newParameters);
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

      const newParameters: FieldParamsLegacy = {
        paramsVersion: '1',
        mode: newFormValues.mode,
        ...(newFormValues.aspectRatio !== null
          ? { overrideDefaultAspectRatio: newFormValues.aspectRatio }
          : {}),
        ...(newFormValues.width !== null
          ? { overrideDefaultWidth: newFormValues.width }
          : {}),
        enableCssClass: newFormValues.enableCssClass,
        enableLazyLoading: newFormValues.enableLazyLoading,
      };

      ctx.setParameters(newParameters);
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

function deriveSelectedAspectRatio(
  legacyValues: LegacyModeValues | null,
  isCustomAspectRatio: boolean,
  aspectRatioOptions: { value: string; label: string }[],
) {
  if (!legacyValues || legacyValues.aspectRatio === null) return null;
  const matchValue = isCustomAspectRatio ? 'custom' : legacyValues.aspectRatio;
  return aspectRatioOptions.find((opt) => opt.value === matchValue) ?? null;
}

export default function FieldConfigScreen({ ctx }: Props) {
  const globalParams = normalizeGlobalParams(ctx.plugin.attributes.parameters);

  const {
    formValues,
    updateLegacyMode,
    updateLayoutConfig,
    updateFieldOption,
    handleModeChange,
  } = useFieldConfigForm(ctx);

  const presetAspectRatioOptions = ASPECT_RATIO_OPTIONS.filter(
    (opt) => opt.value !== 'custom',
  ).map((opt) => ({
    value: opt.value,
    label: opt.label,
  }));

  const aspectRatioOptions = [
    ...presetAspectRatioOptions,
    { value: 'custom', label: 'Custom...' },
  ];
  const presetAspectRatioValues = presetAspectRatioOptions.map(
    (opt) => opt.value,
  );

  const presetWidthOptions = useMemo(
    () => buildWidthOptions(globalParams.widthPresets),
    [globalParams.widthPresets],
  );
  const widthOptions = useMemo(
    () => [...presetWidthOptions, { value: 'custom', label: 'Custom...' }],
    [presetWidthOptions],
  );
  const presetWidthValues = useMemo(
    () => presetWidthOptions.map((opt) => opt.value),
    [presetWidthOptions],
  );

  const selectedMode = modeSelectOptions.find(
    (opt) => opt.value === formValues.mode,
  );

  const legacyValues =
    formValues.mode === 'single' || formValues.mode === 'multiple'
      ? (formValues as LegacyModeValues)
      : null;
  const isLegacyMode = legacyValues !== null;

  const isCustomAspectRatio =
    isLegacyMode &&
    legacyValues.aspectRatio !== null &&
    (legacyValues.aspectRatio === 'custom' ||
      !presetAspectRatioValues.includes(legacyValues.aspectRatio));

  const customAspectRatioValue = deriveCustomAspectRatioValue(
    legacyValues,
    isCustomAspectRatio,
  );
  const customAspectRatioError = isCustomAspectRatio
    ? validateCustomAspectRatio(customAspectRatioValue)
    : undefined;

  const selectedAspectRatio = deriveSelectedAspectRatio(
    legacyValues,
    isCustomAspectRatio,
    aspectRatioOptions,
  );

  const {
    customWidthActive,
    customWidthInput,
    setCustomWidthActive,
    setCustomWidthInput,
  } = useLegacyWidthState(formValues, presetWidthValues);

  const customWidthError = customWidthActive
    ? validateCustomWidth(customWidthInput)
    : undefined;

  const selectedWidth =
    isLegacyMode && legacyValues.width !== null
      ? widthOptions.find(
          (opt) =>
            opt.value === (customWidthActive ? 'custom' : legacyValues.width),
        )
      : null;

  const errors = ctx.errors as Partial<Record<string, string>>;

  return (
    <Canvas ctx={ctx}>
      <Form>
        <div className={styles.fieldBlock}>
          <SelectField
            id="mode"
            name="mode"
            label="Field Mode"
            hint="Choose how this field handles assets"
            required
            selectInputProps={{
              options: modeSelectOptions,
            }}
            value={selectedMode}
            onChange={(option) => {
              if (option && 'value' in option) {
                handleModeChange(
                  option.value as 'single' | 'multiple' | 'layout',
                );
              }
            }}
            error={errors.mode}
          />
        </div>

        <div className={styles.fieldBlock}>
          <SwitchField
            id="enableCssClass"
            name="enableCssClass"
            label="Allow CSS class per asset?"
            hint="Lets editors provide a custom CSS class for each image."
            value={formValues.enableCssClass}
            onChange={(checked) => updateFieldOption('enableCssClass', checked)}
          />
        </div>

        <div className={styles.fieldBlock}>
          <SwitchField
            id="enableLazyLoading"
            name="enableLazyLoading"
            label="Allow lazy loading toggle per asset?"
            hint="Lets editors decide whether each image should lazy load."
            value={formValues.enableLazyLoading}
            onChange={(checked) =>
              updateFieldOption('enableLazyLoading', checked)
            }
          />
        </div>

        {legacyValues && (
          <LegacyModeFields
            legacyValues={legacyValues}
            globalParams={globalParams}
            aspectRatioOptions={aspectRatioOptions}
            selectedAspectRatio={selectedAspectRatio}
            isCustomAspectRatio={isCustomAspectRatio}
            customAspectRatioValue={customAspectRatioValue}
            customAspectRatioError={customAspectRatioError}
            widthOptions={widthOptions}
            selectedWidth={selectedWidth}
            presetWidthOptions={presetWidthOptions}
            presetWidthValues={presetWidthValues}
            customWidthActive={customWidthActive}
            customWidthInput={customWidthInput}
            customWidthError={customWidthError}
            setCustomWidthActive={setCustomWidthActive}
            setCustomWidthInput={setCustomWidthInput}
            updateLegacyMode={updateLegacyMode}
          />
        )}

        {formValues.mode === 'layout' && (
          <div className={styles.fieldBlock}>
            <LayoutBuilder
              config={formValues.layoutConfig}
              onChange={updateLayoutConfig}
              widthOptions={presetWidthOptions}
            />
          </div>
        )}

        {errors.layoutConfig && (
          <div className={styles.fieldBlock}>
            <div style={{ color: 'var(--alert-color)', fontSize: '12px' }}>
              {errors.layoutConfig}
            </div>
          </div>
        )}
      </Form>
    </Canvas>
  );
}
