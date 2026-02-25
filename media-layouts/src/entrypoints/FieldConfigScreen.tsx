import type { RenderManualFieldExtensionConfigScreenCtx } from 'datocms-plugin-sdk';
import { Canvas, Form, SelectField, SwitchField, TextField } from 'datocms-react-ui';
import styles from './FieldConfigScreen.module.css';
import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  ASPECT_RATIO_OPTIONS,
  DEFAULT_WIDTH,
  MODE_OPTIONS,
} from '../constants';
import { validateCustomAspectRatio } from '../utils/aspectRatio';
import {
  buildWidthOptions,
  getWidthLabel,
  MAX_WIDTH,
  MIN_WIDTH,
  parseCustomWidth,
  validateCustomWidth,
} from '../utils/width';
import {
  normalizeGlobalParams,
  normalizeFieldParams,
  createDefaultLayoutConfig,
} from '../utils/fieldParams';
import type {
  ValidFieldParams,
  FieldParams,
  FieldParamsLegacy,
  FieldParamsLayout,
  LayoutConfig,
} from '../types';
import LayoutBuilder from '../components/LayoutBuilder';

type Props = {
  ctx: RenderManualFieldExtensionConfigScreenCtx;
};

const modeSelectOptions = MODE_OPTIONS.map((opt) => ({
  value: opt.value,
  label: opt.label,
}));

export default function FieldConfigScreen({ ctx }: Props) {
  const globalParams = normalizeGlobalParams(ctx.plugin.attributes.parameters);

  const [formValues, setFormValues] = useState<ValidFieldParams>(() =>
    normalizeFieldParams(ctx.parameters as FieldParams)
  );
  const [lastLayoutConfig, setLastLayoutConfig] = useState<LayoutConfig>(() =>
    formValues.mode === 'layout' ? formValues.layoutConfig : createDefaultLayoutConfig()
  );

  const updateLegacyMode = useCallback(
    (
      field: 'mode' | 'aspectRatio' | 'width',
      value: string | number | null
    ) => {
      if (formValues.mode === 'layout') return;

      const newFormValues = { ...formValues, [field]: value } as ValidFieldParams & {
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
    [formValues, ctx]
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
    [formValues, ctx]
  );

  const updateFieldOption = useCallback(
    (field: 'enableCssClass' | 'enableLazyLoading', value: boolean) => {
      const newFormValues = { ...formValues, [field]: value } as ValidFieldParams;
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
    [formValues, ctx]
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
    [ctx, formValues, lastLayoutConfig]
  );

  const presetAspectRatioOptions = ASPECT_RATIO_OPTIONS.filter(
    (opt) => opt.value !== 'custom'
  ).map((opt) => ({
    value: opt.value,
    label: opt.label,
  }));

  const aspectRatioOptions = [
    ...presetAspectRatioOptions,
    { value: 'custom', label: 'Custom...' },
  ];
  const presetAspectRatioValues = presetAspectRatioOptions.map((opt) => opt.value);

  const presetWidthOptions = useMemo(
    () => buildWidthOptions(globalParams.widthPresets),
    [globalParams.widthPresets]
  );
  const widthOptions = useMemo(
    () => [...presetWidthOptions, { value: 'custom', label: 'Custom...' }],
    [presetWidthOptions]
  );
  const presetWidthValues = useMemo(
    () => presetWidthOptions.map((opt) => opt.value),
    [presetWidthOptions]
  );

  const selectedMode = modeSelectOptions.find(
    (opt) => opt.value === formValues.mode
  );

  const legacyValues =
    formValues.mode === 'single' || formValues.mode === 'multiple'
      ? formValues
      : null;
  const isLegacyMode = legacyValues !== null;

  const isCustomAspectRatio =
    isLegacyMode &&
    legacyValues.aspectRatio !== null &&
    (legacyValues.aspectRatio === 'custom' ||
      !presetAspectRatioValues.includes(legacyValues.aspectRatio));
  const customAspectRatioValue =
    legacyValues?.aspectRatio === 'custom'
      ? ''
      : isCustomAspectRatio
        ? legacyValues?.aspectRatio ?? ''
        : '';
  const customAspectRatioError = isCustomAspectRatio
    ? validateCustomAspectRatio(customAspectRatioValue)
    : undefined;

  const selectedAspectRatio =
    isLegacyMode && legacyValues.aspectRatio !== null
      ? aspectRatioOptions.find(
          (opt) =>
            opt.value ===
            (isCustomAspectRatio ? 'custom' : legacyValues.aspectRatio)
        )
      : null;

  const isCustomWidthValue =
    isLegacyMode &&
    legacyValues.width !== null &&
    typeof legacyValues.width === 'number' &&
    !presetWidthValues.includes(legacyValues.width);
  const [customWidthActive, setCustomWidthActive] = useState(isCustomWidthValue);
  const [customWidthInput, setCustomWidthInput] = useState(
    isCustomWidthValue ? String(legacyValues?.width ?? '') : ''
  );
  const customWidthError = customWidthActive
    ? validateCustomWidth(customWidthInput)
    : undefined;

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

  const selectedWidth =
    isLegacyMode && legacyValues.width !== null
      ? widthOptions.find(
          (opt) => opt.value === (customWidthActive ? 'custom' : legacyValues.width)
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
                  option.value as 'single' | 'multiple' | 'layout'
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
            onChange={(checked) => updateFieldOption('enableLazyLoading', checked)}
          />
        </div>

        {legacyValues && (
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
                    checked ? null : globalParams.defaultAspectRatio
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
                  onChange={(option) => {
                    if (option && 'value' in option) {
                      if (option.value === 'custom') {
                        updateLegacyMode(
                          'aspectRatio',
                          customAspectRatioValue || ''
                        );
                      } else {
                        updateLegacyMode('aspectRatio', option.value);
                      }
                    }
                  }}
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

            <div className={styles.fieldBlock}>
              <SwitchField
                id="useDefaultWidth"
                name="useDefaultWidth"
                label="Use global default width?"
                hint={`Global default: ${getWidthLabel(globalParams.defaultWidth, presetWidthOptions)}`}
                value={legacyValues.width === null}
                onChange={(checked) => {
                  const nextWidth = checked ? null : globalParams.defaultWidth;
                  updateLegacyMode('width', nextWidth);
                  if (
                    checked ||
                    nextWidth === null ||
                    nextWidth === 'original' ||
                    typeof nextWidth !== 'number' ||
                    presetWidthValues.includes(nextWidth)
                  ) {
                    setCustomWidthActive(false);
                    setCustomWidthInput('');
                    return;
                  }
                  setCustomWidthActive(true);
                  setCustomWidthInput(String(nextWidth));
                }}
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
                  onChange={(option) => {
                    if (option && 'value' in option) {
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
                  }}
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
                  onChange={(value) => {
                    setCustomWidthInput(value);
                    const parsed = parseCustomWidth(value);
                    if (parsed !== null && !validateCustomWidth(value)) {
                      updateLegacyMode('width', parsed);
                    }
                  }}
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
