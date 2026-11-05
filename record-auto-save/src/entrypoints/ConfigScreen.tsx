import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import Canvas from 'datocms-react-ui/Canvas';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import InputGroup from 'datocms-react-ui/InputGroup';
import SelectInput from 'datocms-react-ui/SelectInput';
import SwitchInput from 'datocms-react-ui/SwitchInput';
import { type FormEvent, useState } from 'react';

type PropTypes = {
  ctx: RenderConfigScreenCtx;
};

type ModelOptionType = {
  label: string;
  value: string;
};

export type PluginParametersType = {
  selectedModels?: ModelOptionType[];
  autoSaveInterval?: number;
  showNotification?: boolean;
  startTimerAfterEditingStops?: boolean;
  parametersHaveBeenSet?: boolean;
};

function ConfigScreen({ ctx }: PropTypes) {
  const pluginParameters = ctx.plugin.attributes
    .parameters as PluginParametersType;
  const savedModels = pluginParameters.selectedModels || [];

  const [selectedModels, setSelectedModels] =
    useState<ModelOptionType[]>(savedModels);
  const [autoSaveInterval, setAutoSaveInterval] = useState<string | null>(
    (pluginParameters.autoSaveInterval || 5).toString(),
  );
  const [showNotification, setShowNotification] = useState(
    pluginParameters.showNotification || false,
  );
  const [startTimerAfterEditingStops, setStartTimerAfterEditingStops] =
    useState(pluginParameters.startTimerAfterEditingStops || false);
  const [hasAValidationError, setHasAValidationError] = useState(false);
  const [isFormDirty, setIsFormDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const allModels: ModelOptionType[] = [];

  for (const key of Object.keys(ctx.itemTypes)) {
    const itemType = ctx.itemTypes[key];
    if (itemType && !itemType.attributes.modular_block) {
      allModels.push({
        label: itemType.attributes.name,
        value: itemType.attributes.api_key,
      });
    }
  }

  const submitHandler = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!isFormDirty || saving) {
      return;
    }

    const interval = Number(autoSaveInterval ?? '');

    if (Number.isNaN(interval) || interval < 1) {
      setHasAValidationError(true);
      return;
    }

    setSaving(true);

    try {
      await ctx.updatePluginParameters({
        selectedModels,
        autoSaveInterval: interval,
        showNotification,
        startTimerAfterEditingStops,
        parametersHaveBeenSet: true,
      });
      setIsFormDirty(false);
      ctx.notice('Settings saved.');
    } finally {
      setSaving(false);
    }
  };

  // The host gives the frame its width and its padding, and draws the
  // "Plugin settings" title above it: the fields start the frame, with no
  // Page around them
  return (
    <Canvas ctx={ctx}>
      <form onSubmit={submitHandler}>
        <FieldWrapper
          label="Models"
          hint="Records of these models save automatically when they have unsaved changes."
        >
          <SelectInput
            multiple
            value={selectedModels.map((model) => model.value)}
            options={allModels}
            acceptValueNotIncludedInOptions={(value) =>
              savedModels.find((model) => model.value === value)
            }
            placeholder="Pick models"
            onChange={(_value, options) => {
              setSelectedModels(options);
              setIsFormDirty(true);
            }}
          />
        </FieldWrapper>
        <FieldWrapper
          label="Interval"
          required
          hint="How long a record waits before it saves its changes."
          error={
            hasAValidationError
              ? 'Enter a number of seconds, 1 or more.'
              : undefined
          }
        >
          <InputGroup
            value={autoSaveInterval}
            onChange={(value) => {
              setAutoSaveInterval(value);
              setIsFormDirty(true);
              setHasAValidationError(false);
            }}
            post="seconds"
          />
        </FieldWrapper>
        <FieldWrapper hint="Each change starts the interval again, so the record saves only after a pause in editing.">
          <SwitchInput
            label="Wait until editing stops"
            value={startTimerAfterEditingStops}
            onChange={(value) => {
              setStartTimerAfterEditingStops(Boolean(value));
              setIsFormDirty(true);
            }}
          />
        </FieldWrapper>
        <FieldWrapper>
          <SwitchInput
            label="Show a notification after each auto-save"
            value={showNotification}
            onChange={(value) => {
              setShowNotification(Boolean(value));
              setIsFormDirty(true);
            }}
          />
        </FieldWrapper>
        <Button
          submit
          tone="primary"
          label="Save"
          busy={saving}
          disabled={
            isFormDirty
              ? undefined
              : { reason: 'There are no changes to save.' }
          }
        />
      </form>
    </Canvas>
  );
}

export default ConfigScreen;
