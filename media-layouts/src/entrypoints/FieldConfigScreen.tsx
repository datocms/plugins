import type { RenderManualFieldExtensionConfigScreenCtx } from 'datocms-plugin-sdk';
import { Canvas, Form, SelectField, SwitchField } from 'datocms-react-ui';
import { useState, useCallback } from 'react';
import {
  ASPECT_RATIO_OPTIONS,
  WIDTH_OPTIONS,
  MODE_OPTIONS,
} from '../constants';
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
      };
      setFormValues(newFormValues);

      const newParameters: FieldParamsLayout = {
        paramsVersion: '2',
        mode: 'layout',
        layoutConfig,
      };

      ctx.setParameters(newParameters);
    },
    [formValues, ctx]
  );

  const handleModeChange = useCallback(
    (newMode: 'single' | 'multiple' | 'layout') => {
      if (newMode === 'layout') {
        const newFormValues: ValidFieldParams = {
          mode: 'layout',
          layoutConfig: createDefaultLayoutConfig(),
        };
        setFormValues(newFormValues);

        const newParameters: FieldParamsLayout = {
          paramsVersion: '2',
          mode: 'layout',
          layoutConfig: newFormValues.layoutConfig,
        };
        ctx.setParameters(newParameters);
      } else {
        const newFormValues: ValidFieldParams = {
          mode: newMode,
          aspectRatio: null,
          width: null,
        };
        setFormValues(newFormValues);

        const newParameters: FieldParamsLegacy = {
          paramsVersion: '1',
          mode: newMode,
        };
        ctx.setParameters(newParameters);
      }
    },
    [ctx]
  );

  const aspectRatioOptions = ASPECT_RATIO_OPTIONS.filter(
    (opt) => opt.value !== 'custom'
  ).map((opt) => ({
    value: opt.value,
    label: opt.label,
  }));

  const widthOptions = WIDTH_OPTIONS.map((opt) => ({
    value: opt.value,
    label: opt.label,
  }));

  const selectedMode = modeSelectOptions.find(
    (opt) => opt.value === formValues.mode
  );

  const isLegacyMode =
    formValues.mode === 'single' || formValues.mode === 'multiple';

  const selectedAspectRatio =
    isLegacyMode && formValues.aspectRatio !== null
      ? aspectRatioOptions.find((opt) => opt.value === formValues.aspectRatio)
      : null;

  const selectedWidth =
    isLegacyMode && formValues.width !== null
      ? widthOptions.find((opt) => opt.value === formValues.width)
      : null;

  const errors = ctx.errors as Partial<Record<string, string>>;

  return (
    <Canvas ctx={ctx}>
      <Form>
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

        {isLegacyMode && (
          <>
            <SwitchField
              id="useDefaultAspectRatio"
              name="useDefaultAspectRatio"
              label="Use global default aspect ratio?"
              hint={`Global default: ${globalParams.defaultAspectRatio}`}
              value={formValues.aspectRatio === null}
              onChange={(checked) =>
                updateLegacyMode(
                  'aspectRatio',
                  checked ? null : globalParams.defaultAspectRatio
                )
              }
            />

            {formValues.aspectRatio !== null && (
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
                    updateLegacyMode('aspectRatio', option.value);
                  }
                }}
              />
            )}

            <SwitchField
              id="useDefaultWidth"
              name="useDefaultWidth"
              label="Use global default width?"
              hint={`Global default: ${globalParams.defaultWidth}px`}
              value={formValues.width === null}
              onChange={(checked) =>
                updateLegacyMode(
                  'width',
                  checked ? null : globalParams.defaultWidth
                )
              }
            />

            {formValues.width !== null && (
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
                    updateLegacyMode('width', option.value);
                  }
                }}
              />
            )}
          </>
        )}

        {formValues.mode === 'layout' && (
          <LayoutBuilder
            config={formValues.layoutConfig}
            onChange={updateLayoutConfig}
          />
        )}

        {errors.layoutConfig && (
          <div style={{ color: 'var(--alert-color)', fontSize: '12px' }}>
            {errors.layoutConfig}
          </div>
        )}
      </Form>
    </Canvas>
  );
}
