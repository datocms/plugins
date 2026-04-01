import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { Button, Canvas, Form, SelectField, TextField } from 'datocms-react-ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ASPECT_RATIO_OPTIONS, DEFAULT_WIDTH } from '../constants';
import type { ValidGlobalParams } from '../types';
import { validateCustomAspectRatio } from '../utils/aspectRatio';
import { normalizeGlobalParams } from '../utils/fieldParams';
import {
  buildWidthOptions,
  MAX_WIDTH,
  MIN_WIDTH,
  parseCustomWidth,
  validateCustomWidth,
} from '../utils/width';
import styles from './ConfigScreen.module.css';

type Props = {
  ctx: RenderConfigScreenCtx;
};

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
  const isCustomAspectRatio =
    formValues.defaultAspectRatio === 'custom' ||
    !presetAspectRatioValues.includes(formValues.defaultAspectRatio);
  const customAspectRatioValue =
    formValues.defaultAspectRatio === 'custom'
      ? ''
      : isCustomAspectRatio
        ? formValues.defaultAspectRatio
        : '';
  const customAspectRatioError = isCustomAspectRatio
    ? validateCustomAspectRatio(customAspectRatioValue)
    : undefined;

  const presetWidthOptions = useMemo(
    () => buildWidthOptions(formValues.widthPresets),
    [formValues.widthPresets],
  );
  const widthOptions = useMemo(
    () => [...presetWidthOptions, { value: 'custom', label: 'Custom...' }],
    [presetWidthOptions],
  );
  const presetWidthValues = useMemo(
    () => presetWidthOptions.map((opt) => opt.value),
    [presetWidthOptions],
  );

  const isCustomWidthValue =
    typeof formValues.defaultWidth === 'number' &&
    !presetWidthValues.includes(formValues.defaultWidth);
  const [customWidthActive, setCustomWidthActive] =
    useState(isCustomWidthValue);
  const [customWidthInput, setCustomWidthInput] = useState(
    isCustomWidthValue ? String(formValues.defaultWidth) : '',
  );
  const customWidthError = customWidthActive
    ? validateCustomWidth(customWidthInput)
    : undefined;

  useEffect(() => {
    const shouldUseCustom =
      typeof formValues.defaultWidth === 'number' &&
      !presetWidthValues.includes(formValues.defaultWidth);
    if (shouldUseCustom) {
      setCustomWidthActive(true);
      setCustomWidthInput(String(formValues.defaultWidth));
      return;
    }
    setCustomWidthActive(false);
    setCustomWidthInput('');
  }, [formValues.defaultWidth, presetWidthValues]);

  const selectedAspectRatio = aspectRatioOptions.find(
    (opt) =>
      opt.value ===
      (isCustomAspectRatio ? 'custom' : formValues.defaultAspectRatio),
  );

  const selectedWidth = widthOptions.find(
    (opt) =>
      opt.value === (customWidthActive ? 'custom' : formValues.defaultWidth),
  );

  const [presetDrafts, setPresetDrafts] = useState(() =>
    formValues.widthPresets.map((preset, i) => ({
      id: `preset-init-${i}-${Date.now()}`,
      label: preset.label,
      width: String(preset.value),
    })),
  );

  useEffect(() => {
    setPresetDrafts((existingDrafts) =>
      formValues.widthPresets.map((preset, i) => {
        const existingDraft = existingDrafts[i];
        return {
          id: existingDraft?.id ?? `preset-sync-${i}-${Date.now()}`,
          label: preset.label,
          width: String(preset.value),
        };
      }),
    );
  }, [formValues.widthPresets]);

  const handlePresetChange = useCallback(
    (index: number, next: { label?: string; width?: string }) => {
      setPresetDrafts((drafts) => {
        const updated = drafts.map((draft, i) =>
          i === index ? { ...draft, ...next } : draft,
        );
        return updated;
      });

      const draft = {
        ...presetDrafts[index],
        ...next,
      };
      const label = draft.label.trim();
      const widthError = validateCustomWidth(draft.width);
      const parsed = parseCustomWidth(draft.width);

      if (!label || widthError || parsed === null) return;

      const updatedPresets = formValues.widthPresets.map((preset, i) =>
        i === index ? { ...preset, label, value: parsed } : preset,
      );
      update('widthPresets', updatedPresets);
    },
    [formValues.widthPresets, presetDrafts, update],
  );

  const handleAddPreset = useCallback(() => {
    const nextPreset = {
      label: `Preset ${formValues.widthPresets.length + 1}`,
      value: DEFAULT_WIDTH,
    };
    const updatedPresets = [...formValues.widthPresets, nextPreset];
    setPresetDrafts((drafts) => [
      ...drafts,
      {
        id: `preset-new-${Date.now()}`,
        label: nextPreset.label,
        width: String(nextPreset.value),
      },
    ]);
    update('widthPresets', updatedPresets);
  }, [formValues.widthPresets, update]);

  const handleRemovePreset = useCallback(
    (index: number) => {
      const updatedPresets = formValues.widthPresets.filter(
        (_, i) => i !== index,
      );
      setPresetDrafts((drafts) => drafts.filter((_, i) => i !== index));
      update('widthPresets', updatedPresets);
    },
    [formValues.widthPresets, update],
  );

  return (
    <Canvas ctx={ctx}>
      <Form>
        <SelectField
          id="defaultAspectRatio"
          name="defaultAspectRatio"
          label="Default Aspect Ratio"
          hint="The default aspect ratio for new assets"
          selectInputProps={{
            options: aspectRatioOptions,
          }}
          value={selectedAspectRatio}
          onChange={(option) => {
            if (option && 'value' in option) {
              if (option.value === 'custom') {
                update('defaultAspectRatio', customAspectRatioValue || '');
              } else {
                update('defaultAspectRatio', option.value);
              }
            }
          }}
        />

        {isCustomAspectRatio && (
          <TextField
            id="defaultCustomAspectRatio"
            name="defaultCustomAspectRatio"
            label="Custom Aspect Ratio"
            hint="Use W:H (e.g., 2.35:1)"
            placeholder="2.35:1"
            value={customAspectRatioValue}
            onChange={(value) => update('defaultAspectRatio', value)}
            error={customAspectRatioError}
          />
        )}

        <SelectField
          id="defaultWidth"
          name="defaultWidth"
          label="Default Width"
          hint="The default width for new assets"
          selectInputProps={{
            options: widthOptions,
          }}
          value={selectedWidth}
          onChange={(option) => {
            if (option && 'value' in option) {
              if (option.value === 'custom') {
                const fallback =
                  typeof formValues.defaultWidth === 'number'
                    ? formValues.defaultWidth
                    : DEFAULT_WIDTH;
                setCustomWidthActive(true);
                setCustomWidthInput(String(fallback));
                update('defaultWidth', fallback);
              } else {
                setCustomWidthActive(false);
                setCustomWidthInput('');
                update(
                  'defaultWidth',
                  option.value as ValidGlobalParams['defaultWidth'],
                );
              }
            }
          }}
        />

        {customWidthActive && (
          <TextField
            id="defaultCustomWidth"
            name="defaultCustomWidth"
            label="Custom Width"
            hint={`Pixels (${MIN_WIDTH}–${MAX_WIDTH})`}
            placeholder={String(DEFAULT_WIDTH)}
            value={customWidthInput}
            onChange={(value) => {
              setCustomWidthInput(value);
              const parsed = parseCustomWidth(value);
              if (parsed !== null && !validateCustomWidth(value)) {
                update('defaultWidth', parsed);
              }
            }}
            error={customWidthError}
            textInputProps={{
              type: 'number',
              min: MIN_WIDTH,
              max: MAX_WIDTH,
            }}
          />
        )}

        <div className={styles.presetsSection}>
          <div className={styles.presetsHeader}>
            <div>
              <div className={styles.presetsTitle}>Width presets</div>
              <div className={styles.presetsHint}>
                Add custom width options to guide editors with named sizes.
              </div>
            </div>
            <Button
              type="button"
              buttonSize="xs"
              buttonType="muted"
              onClick={handleAddPreset}
            >
              + Add preset
            </Button>
          </div>

          {presetDrafts.length === 0 ? (
            <div className={styles.presetsEmpty}>No custom presets yet.</div>
          ) : (
            <div className={styles.presetsList}>
              {presetDrafts.map((preset, index) => {
                const labelError = preset.label.trim()
                  ? undefined
                  : 'Label is required';
                const widthError = validateCustomWidth(preset.width);
                return (
                  <div key={preset.id} className={styles.presetRow}>
                    <div className={styles.presetFields}>
                      <TextField
                        id={`preset-label-${index}`}
                        name={`preset-label-${index}`}
                        label="Label"
                        placeholder="e.g., Hero image"
                        value={preset.label}
                        onChange={(value) =>
                          handlePresetChange(index, { label: value })
                        }
                        error={labelError}
                      />
                      <TextField
                        id={`preset-width-${index}`}
                        name={`preset-width-${index}`}
                        label="Width (px)"
                        placeholder={String(DEFAULT_WIDTH)}
                        value={preset.width}
                        onChange={(value) =>
                          handlePresetChange(index, { width: value })
                        }
                        error={widthError}
                        textInputProps={{
                          type: 'number',
                          min: MIN_WIDTH,
                          max: MAX_WIDTH,
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      className={styles.removePresetButton}
                      onClick={() => handleRemovePreset(index)}
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Form>
    </Canvas>
  );
}
