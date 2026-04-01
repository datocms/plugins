import type { RenderConfigScreenCtx } from "datocms-plugin-sdk";
import {
  Button,
  Canvas,
  FieldGroup,
  Form,
  SelectField,
  SwitchField,
  TextField,
} from "datocms-react-ui";
import { useEffect, useState } from "react";
import type { ActionMeta, GroupBase, MultiValue } from "react-select";

type PropTypes = {
  ctx: RenderConfigScreenCtx;
};

type ModelOptionType = {
  label: string;
  value: string;
};

export type PluginParametersType = {
  selectedModels: ModelOptionType[];
  autoSaveInterval: number;
  showNotification: boolean;
  parametersHaveBeenSet: boolean;
};

function ConfigScreen({ ctx }: PropTypes) {
  const pluginParameters = ctx.plugin.attributes
    .parameters as PluginParametersType;

  const [selectedModels, setSelectedModels] = useState(
    pluginParameters.selectedModels || []
  );
  const [autoSaveInterval, setAutoSaveInterval] = useState(
    pluginParameters.autoSaveInterval.toString()
  );
  const [showNotification, setShowNotification] = useState(
    pluginParameters.showNotification
  );
  const [hasAValidationError, setHasAValidationError] = useState(false);
  const [formIsSubmited, setFormIsSubmited] = useState(true);

  const allModels: ModelOptionType[] = [];

  Object.keys(ctx.itemTypes).forEach((key) => {
    const itemType = ctx.itemTypes[key];
    if (itemType && !itemType.attributes.modular_block) {
      allModels.push({
        label: itemType.attributes.name,
        value: itemType.attributes.api_key,
      });
    }
  });

  const modelSelectHandler = (
    newValue: MultiValue<ModelOptionType>,
    actionMeta: ActionMeta<ModelOptionType>
  ) => {
    setSelectedModels((oldSelectedModels: ModelOptionType[]) => {
      let newSelectedModels = [...oldSelectedModels];
      switch (actionMeta.action) {
        case "select-option":
          newSelectedModels.push(newValue[selectedModels.length]);
          break;
        case "clear":
          newSelectedModels = [];
          break;
        case "remove-value":
          newSelectedModels = newSelectedModels.filter(
            (item) => item.value !== actionMeta.removedValue?.value
          );
      }
      return newSelectedModels;
    });
  };

  const intervalChangeHandler = (newValue: string) => {
    setAutoSaveInterval(newValue);
  };

  const showNotificationHandler = () => {
    setShowNotification(
      (previousShowNotification) => !previousShowNotification
    );
  };

  const submitHandler = async () => {
    if (Number.isNaN(+autoSaveInterval) || +autoSaveInterval < 1) {
      setHasAValidationError(true);
      return;
    }
    await ctx.updatePluginParameters({
      selectedModels,
      autoSaveInterval: +autoSaveInterval,
      showNotification,
      parametersHaveBeenSet: true,
    });
    setFormIsSubmited(true);
    await ctx.notice("Settings saved");
  };

  const errorMessage = hasAValidationError
    ? "The interval must be a number greater than one"
    : null;

  useEffect(() => {
    setHasAValidationError(false);
  }, []);

  useEffect(() => {
    setFormIsSubmited(false);
  }, []);

  return (
    <Canvas ctx={ctx}>
      <Form onSubmit={submitHandler}>
        <FieldGroup>
          <SelectField<ModelOptionType, true, GroupBase<ModelOptionType>>
            name="modelsWithAutosave"
            id="modelsWithAutosave"
            label="Models where auto-save is enabled"
            hint="Select one of the options"
            value={selectedModels}
            selectInputProps={{
              isMulti: true,
              options: allModels,
            }}
            onChange={modelSelectHandler}
          />
          <TextField
            required
            name="autoSaveInterval"
            id="autoSaveInterval"
            label="Auto-save interval (seconds)"
            value={autoSaveInterval}
            textInputProps={{ monospaced: true }}
            onChange={intervalChangeHandler}
            error={errorMessage}
          />
          <SwitchField
            name="displayNotification"
            id="displayNotification"
            label="Recieve a notification for each auto-save"
            value={showNotification}
            onChange={showNotificationHandler}
          />
        </FieldGroup>
        <FieldGroup>
          <Button
            type="submit"
            fullWidth
            buttonType="primary"
            disabled={formIsSubmited}
          >
            Save
          </Button>
        </FieldGroup>
      </Form>
    </Canvas>
  );
}

export default ConfigScreen;
