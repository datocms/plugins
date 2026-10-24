/**
 * Configuration screen for the Locale Duplicate plugin.
 * Allows users to select which fields should display copy buttons
 * in the record editing interface.
 */

import { buildClient } from '@datocms/cma-client-browser';
import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import Canvas from 'datocms-react-ui/Canvas';
import CardList from 'datocms-react-ui/CardList';
import EmptySlot from 'datocms-react-ui/EmptySlot';
import EntityRow from 'datocms-react-ui/EntityRow';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import Link from 'datocms-react-ui/Link';
import { Page } from 'datocms-react-ui/Page';
import SelectInput from 'datocms-react-ui/SelectInput';
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { AddIcon } from '../icons';
import {
  type FieldCopyConfig,
  type FieldOption,
  getErrorMessage,
  type ModelOption,
} from '../types';
import {
  createCachedModelLoader,
  getLargeSelectionHint,
  getVisibleOptions,
  indexFieldCopyConfigs,
  LARGE_SELECTION_THRESHOLD,
  normalizeFieldCopyConfigs,
  validatePluginParameters,
} from '../utils/selection';
import s from './ConfigScreen.module.css';

/**
 * Main configuration screen component.
 * Manages field configurations and provides access to mass duplication feature.
 */
export default function ConfigScreen({ ctx }: { ctx: RenderConfigScreenCtx }) {
  const contextRef = useRef(ctx);
  contextRef.current = ctx;
  const { currentUserAccessToken, environment, cmaBaseUrl } = ctx;
  const siteId = ctx.site.id;
  const pluginId = ctx.plugin.id;
  const client = useMemo(
    () =>
      currentUserAccessToken
        ? buildClient({
            apiToken: currentUserAccessToken,
            environment,
            baseUrl: cmaBaseUrl,
          })
        : null,
    [currentUserAccessToken, environment, cmaBaseUrl],
  );
  const [selectedModel, setSelectedModel] = useState<ModelOption | null>(null);
  const [selectedField, setSelectedField] = useState<FieldOption | null>(null);
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [modelFields, setModelFields] = useState<FieldOption[]>([]);
  const [modelSearch, setModelSearch] = useState('');
  const [fieldSearch, setFieldSearch] = useState('');
  const [savedConfigs, setSavedConfigs] = useState<FieldCopyConfig[]>([]);
  const [originalConfigs, setOriginalConfigs] = useState<FieldCopyConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingFields, setIsLoadingFields] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [modelsError, setModelsError] = useState<string | undefined>();
  const [fieldsError, setFieldsError] = useState<string | undefined>();
  const dataScope = useMemo(
    () => ({ client, siteId, pluginId }),
    [client, siteId, pluginId],
  );
  const configuredFields = useMemo(
    () => indexFieldCopyConfigs(savedConfigs),
    [savedConfigs],
  );
  const selectedModelId = selectedModel?.value;
  const availableFields = useMemo(
    () =>
      modelFields.filter(
        (field) =>
          !configuredFields.get(selectedModelId ?? '')?.has(field.value),
      ),
    [modelFields, configuredFields, selectedModelId],
  );
  const visibleModels = useMemo(
    () => getVisibleOptions(availableModels, modelSearch),
    [availableModels, modelSearch],
  );
  const visibleFields = useMemo(
    () => getVisibleOptions(availableFields, fieldSearch),
    [availableFields, fieldSearch],
  );
  const loadModelFields = useMemo(
    () =>
      createCachedModelLoader(async (modelId: string) => {
        const fieldContext = contextRef.current;
        if (
          !client ||
          fieldContext.site.id !== siteId ||
          fieldContext.environment !== environment ||
          fieldContext.cmaBaseUrl !== cmaBaseUrl
        ) {
          throw new Error(
            'API access is required. Check the plugin permissions.',
          );
        }
        // The SDK repository is partial. This helper returns all model fields.
        const fields = await fieldContext.loadItemTypeFields(modelId);
        return fields
          .filter((field) => field.attributes.localized)
          .map((field) => ({ label: field.attributes.label, value: field.id }));
      }),
    [client, siteId, environment, cmaBaseUrl],
  );

  /**
   * Load saved configurations and fetch available models on component mount
   */
  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setModelsError(undefined);
    setAvailableModels([]);
    setSelectedModel(null);
    setSelectedField(null);
    const configArray = normalizeFieldCopyConfigs(
      contextRef.current.plugin.attributes.parameters?.fieldConfigs,
    );
    setSavedConfigs(configArray);
    setOriginalConfigs(configArray);
    const scopedClient = dataScope.client;
    if (!scopedClient) {
      setIsLoading(false);
      return;
    }

    const loadData = async () => {
      try {
        // Fetch all models (excluding modular blocks)
        const models = await scopedClient.itemTypes.list();
        const modelOptions = models
          .filter((model) => !model.modular_block)
          .map((model) => ({
            label: model.name,
            value: model.id,
          }));

        if (active) setAvailableModels(modelOptions);
      } catch (error) {
        if (active) {
          console.error('Error loading data:', error);
          setModelsError(`Couldn't load the models: ${getErrorMessage(error)}`);
        }
      } finally {
        if (active) setIsLoading(false);
      }
    };

    loadData();
    return () => {
      active = false;
    };
  }, [dataScope]);

  /**
   * Load available fields when a model is selected.
   * Only shows localized fields that aren't already configured.
   */
  useEffect(() => {
    let active = true;
    setModelFields([]);
    setFieldsError(undefined);
    if (!selectedModelId) {
      setIsLoadingFields(false);
      return;
    }
    setIsLoadingFields(true);
    const loadFields = async () => {
      try {
        const fields = await loadModelFields(selectedModelId);
        if (active) setModelFields(fields);
      } catch (error) {
        if (active) {
          console.error('Error loading fields:', error);
          setFieldsError(`Couldn't load the fields: ${getErrorMessage(error)}`);
        }
      } finally {
        if (active) setIsLoadingFields(false);
      }
    };

    loadFields();
    return () => {
      active = false;
    };
  }, [selectedModelId, loadModelFields]);

  /**
   * Add a new field configuration to the list
   */
  const handleAddConfiguration = useCallback(() => {
    if (!selectedModel || !selectedField) {
      ctx.notice('Pick a model and a field first.');
      return;
    }

    // Check if this configuration already exists
    const exists = configuredFields
      .get(selectedModel.value)
      ?.has(selectedField.value);

    if (exists) {
      ctx.notice('This field already has a copy button.');
      return;
    }

    // Add new configuration
    setSavedConfigs([
      ...savedConfigs,
      {
        modelId: selectedModel.value,
        modelLabel: selectedModel.label,
        fieldId: selectedField.value,
        fieldLabel: selectedField.label,
      },
    ]);

    // Reset selections
    setSelectedModel(null);
    setSelectedField(null);
  }, [selectedModel, selectedField, savedConfigs, configuredFields, ctx]);

  /**
   * Remove a field configuration from the list
   */
  const handleRemoveConfiguration = useCallback(
    (index: number) => {
      const newConfigs = savedConfigs.filter((_, i) => i !== index);
      setSavedConfigs(newConfigs);
    },
    [savedConfigs],
  );

  /**
   * Save all field configurations to the plugin parameters
   */
  const handleSave = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setIsSaving(true);
      try {
        const parameters = {
          ...ctx.plugin.attributes.parameters,
          fieldConfigs: savedConfigs,
        };
        validatePluginParameters(parameters);
        await ctx.updatePluginParameters(parameters);

        setOriginalConfigs(savedConfigs);
        ctx.notice('Settings saved.');
      } catch (error) {
        console.error('Error saving configuration:', error);
        ctx.alert(`Couldn't save the settings: ${getErrorMessage(error)}`);
      } finally {
        setIsSaving(false);
      }
    },
    [savedConfigs, ctx],
  );

  /**
   * Check if configurations have been modified since last save
   */
  const hasConfigurationChanged = useMemo(() => {
    if (savedConfigs.length !== originalConfigs.length) {
      return true;
    }

    return savedConfigs.some((config, index) => {
      const original = originalConfigs[index];
      return (
        !original ||
        config.modelId !== original.modelId ||
        config.fieldId !== original.fieldId
      );
    });
  }, [savedConfigs, originalConfigs]);

  /**
   * Get model name by ID for display purposes
   */
  const modelNames = useMemo(
    () => new Map(availableModels.map((model) => [model.value, model.label])),
    [availableModels],
  );
  const getModelName = useCallback(
    (modelId: string) => modelNames.get(modelId) || modelId,
    [modelNames],
  );

  /**
   * Handle model selection change
   */
  const handleModelChange = useCallback((newValue: ModelOption | null) => {
    setSelectedModel(newValue);
    setSelectedField(null);
    setFieldSearch('');
  }, []);

  const environmentPrefix = ctx.isEnvironmentPrimary
    ? ''
    : `/environments/${ctx.environment}`;
  const massDuplicationPath = `${environmentPrefix}/configuration/p/${ctx.plugin.id}/pages/massLocaleDuplication`;

  return (
    <Canvas ctx={ctx}>
      <ErrorBoundary>
        <Page className={s.page}>
          <Page.Content>
            <form onSubmit={handleSave}>
              <Page.Section>
                <Page.SectionTitle>Copy buttons</Page.SectionTitle>
                <Page.SectionDescription>
                  These fields get a button in the record editor. In the main
                  locale it copies the value to every other locale. In any other
                  locale it copies the value from the main locale.
                </Page.SectionDescription>
                {!client && (
                  <Callout tone="danger" title="No access to your API token">
                    The plugin can't list your models without it. Check the
                    plugin's permissions.
                  </Callout>
                )}
                <div className="form__field form__row">
                  <div className="form__row__cell">
                    <FieldWrapper
                      label="Model"
                      hint={getLargeSelectionHint(
                        availableModels.length,
                        'models',
                      )}
                      error={modelsError}
                    >
                      <SelectInput
                        value={selectedModel?.value ?? null}
                        options={visibleModels}
                        // A model picked from a search stays shown after the
                        // search ends and the visible options change
                        acceptValueNotIncludedInOptions={() =>
                          selectedModel ?? undefined
                        }
                        onChange={(_id, option) => handleModelChange(option)}
                        clearable
                        loading={isLoading}
                        disabled={!client}
                        search={
                          availableModels.length > LARGE_SELECTION_THRESHOLD
                            ? { onQueryChange: setModelSearch }
                            : undefined
                        }
                      />
                    </FieldWrapper>
                  </div>
                  <div className="form__row__cell">
                    <FieldWrapper
                      label="Field"
                      hint={
                        getLargeSelectionHint(
                          availableFields.length,
                          'fields',
                        ) ??
                        (selectedModel &&
                        !isLoadingFields &&
                        !fieldsError &&
                        availableFields.length === 0
                          ? 'This model has no other localized fields.'
                          : 'Only localized fields can have a copy button.')
                      }
                      error={fieldsError}
                    >
                      <SelectInput
                        value={selectedField?.value ?? null}
                        options={visibleFields}
                        acceptValueNotIncludedInOptions={() =>
                          selectedField ?? undefined
                        }
                        onChange={(_id, option) => setSelectedField(option)}
                        clearable
                        loading={isLoadingFields}
                        disabled={!selectedModel || isLoadingFields}
                        search={
                          availableFields.length > LARGE_SELECTION_THRESHOLD
                            ? { onQueryChange: setFieldSearch }
                            : undefined
                        }
                      />
                    </FieldWrapper>
                  </div>
                </div>
                <div className={s.block}>
                  <Button
                    icon={AddIcon}
                    label="Add field"
                    expand={false}
                    onClick={handleAddConfiguration}
                    disabled={
                      selectedModel && selectedField
                        ? undefined
                        : { reason: 'Pick a model and a field first.' }
                    }
                  />
                </div>
                <div className={s.block}>
                  <CardList empty={<EmptySlot message="No fields yet" />}>
                    {savedConfigs.map((config, index) => (
                      <CardList.Item
                        key={`${config.modelId}-${config.fieldId}`}
                        row={{
                          summary: (
                            <EntityRow
                              layout="row"
                              kicker={
                                config.modelLabel ||
                                getModelName(config.modelId)
                              }
                              title={
                                config.fieldLabel ||
                                `Field ID: ${config.fieldId}`
                              }
                            />
                          ),
                          actions: (
                            <CardList.RemoveButton
                              label="Remove field"
                              onClick={() => handleRemoveConfiguration(index)}
                            />
                          ),
                        }}
                      />
                    ))}
                  </CardList>
                </div>
                <div>
                  <Button
                    submit
                    tone="primary"
                    expand={false}
                    label="Save"
                    busy={isSaving}
                    disabled={
                      hasConfigurationChanged
                        ? undefined
                        : { reason: 'There are no changes to save.' }
                    }
                  />
                </div>
              </Page.Section>
            </form>
            <Page.Section>
              <Page.SectionTitle>Mass duplication</Page.SectionTitle>
              <Page.SectionDescription>
                Copies all the content of one locale into another, across many
                models at once. It overwrites the content of the target locale.
              </Page.SectionDescription>
              <p className="Page__content__section__text">
                <Link to={massDuplicationPath}>
                  Open Mass locale duplication
                </Link>
              </p>
            </Page.Section>
          </Page.Content>
        </Page>
      </ErrorBoundary>
    </Canvas>
  );
}
