/**
 * Configuration screen for the Locale Duplicate plugin.
 * Allows users to select which fields should display copy buttons
 * in the record editing interface.
 */

import { buildClient } from '@datocms/cma-client-browser';
import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import {
  Button,
  Canvas,
  FieldGroup,
  Form,
  Section,
  SelectField,
  Spinner,
} from 'datocms-react-ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ErrorBoundary } from '../components/ErrorBoundary';
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
      contextRef.current.notice(
        'API access is required. Check the plugin permissions.',
      );
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
          contextRef.current.notice(
            `Error loading data: ${getErrorMessage(error)}`,
          );
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
          contextRef.current.notice(
            `Error loading fields: ${getErrorMessage(error)}`,
          );
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
      ctx.notice('Please select both a model and a field');
      return;
    }

    // Check if this configuration already exists
    const exists = configuredFields
      .get(selectedModel.value)
      ?.has(selectedField.value);

    if (exists) {
      ctx.notice('This configuration already exists');
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
  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      const parameters = {
        ...ctx.plugin.attributes.parameters,
        fieldConfigs: savedConfigs,
      };
      validatePluginParameters(parameters);
      await ctx.updatePluginParameters(parameters);

      setOriginalConfigs(savedConfigs);
      ctx.notice('Configuration saved successfully');
    } catch (error) {
      console.error('Error saving configuration:', error);
      ctx.notice(`Error saving configuration: ${getErrorMessage(error)}`);
    } finally {
      setIsSaving(false);
    }
  }, [savedConfigs, ctx]);

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

  /**
   * Handle field selection change
   */
  const handleFieldChange = useCallback((newValue: FieldOption | null) => {
    setSelectedField(newValue);
  }, []);

  /**
   * Navigate to mass duplication page
   */
  const handleNavigateToMassDuplication = useCallback(() => {
    const environmentPrefix = ctx.isEnvironmentPrimary
      ? ''
      : `/environments/${ctx.environment}`;
    ctx.navigateTo(
      `${environmentPrefix}/configuration/p/${ctx.plugin.id}/pages/massLocaleDuplication`,
    );
  }, [ctx]);

  if (isLoading) {
    return (
      <Canvas ctx={ctx}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: '200px',
          }}
        >
          <Spinner />
        </div>
      </Canvas>
    );
  }

  return (
    <ErrorBoundary ctx={ctx}>
      <Canvas ctx={ctx}>
        <Form>
          <Section title="Field Copy Configuration">
            <FieldGroup>
              <p style={{ marginBottom: 'var(--spacing-m)' }}>
                Configure which fields should have copy buttons in the record
                editing interface. Select a model and a localized field to
                enable the copy functionality.
              </p>

              <div
                style={{
                  display: 'flex',
                  gap: 'var(--spacing-m)',
                  marginBottom: 'var(--spacing-m)',
                }}
              >
                <div style={{ flex: 1 }}>
                  <SelectField
                    name="model"
                    id="model"
                    label="Model"
                    hint={
                      getLargeSelectionHint(availableModels.length, 'models') ??
                      'Select a model'
                    }
                    value={selectedModel}
                    selectInputProps={{
                      isMulti: false,
                      options: visibleModels,
                      onInputChange: setModelSearch,
                      ...(availableModels.length > LARGE_SELECTION_THRESHOLD
                        ? { filterOption: null }
                        : {}),
                    }}
                    onChange={(newValue) =>
                      handleModelChange(newValue as ModelOption | null)
                    }
                  />
                </div>

                <div style={{ flex: 1, position: 'relative' }}>
                  <div
                    style={{
                      opacity: isLoadingFields ? 0.6 : 1,
                      transition: 'opacity 0.2s ease',
                      pointerEvents: isLoadingFields ? 'none' : 'auto',
                    }}
                  >
                    <SelectField
                      name="field"
                      id="field"
                      label="Localized Field"
                      hint={
                        isLoadingFields
                          ? 'Loading fields...'
                          : (getLargeSelectionHint(
                              availableFields.length,
                              'fields',
                            ) ?? 'Select a localized field')
                      }
                      value={selectedField}
                      selectInputProps={{
                        isDisabled: !selectedModel || isLoadingFields,
                        isMulti: false,
                        options: visibleFields,
                        onInputChange: setFieldSearch,
                        ...(availableFields.length > LARGE_SELECTION_THRESHOLD
                          ? { filterOption: null }
                          : {}),
                        isLoading: isLoadingFields,
                        placeholder: isLoadingFields
                          ? 'Loading...'
                          : 'Select...',
                      }}
                      onChange={(newValue) =>
                        handleFieldChange(newValue as FieldOption | null)
                      }
                    />
                  </div>
                  {isLoadingFields && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '38px',
                        right: '48px',
                      }}
                    >
                      <Spinner size={16} />
                    </div>
                  )}
                </div>
              </div>

              <Button
                buttonType="primary"
                buttonSize="s"
                onClick={handleAddConfiguration}
                disabled={!selectedModel || !selectedField}
              >
                Add Configuration
              </Button>
            </FieldGroup>
          </Section>

          <Section title="Configured Fields">
            <FieldGroup>
              {savedConfigs.length === 0 ? (
                <p
                  style={{
                    textAlign: 'center',
                    padding: 'var(--spacing-l)',
                    color: 'var(--color--ink-subtle)',
                    backgroundColor: 'var(--color--surface-muted)',
                    borderRadius: '4px',
                  }}
                >
                  No fields configured yet. Add a configuration above to get
                  started.
                </p>
              ) : (
                <div style={{ marginBottom: 'var(--spacing-m)' }}>
                  {savedConfigs.map((config, index) => (
                    <div
                      key={`${config.modelId}-${config.fieldId}`}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: 'var(--spacing-s)',
                        backgroundColor: 'var(--color--surface-muted)',
                        borderRadius: '4px',
                        marginBottom: 'var(--spacing-s)',
                      }}
                    >
                      <div>
                        <strong>
                          {config.modelLabel || getModelName(config.modelId)}
                        </strong>
                        <span style={{ margin: '0 var(--spacing-s)' }}>→</span>
                        <span>
                          {config.fieldLabel || `Field ID: ${config.fieldId}`}
                        </span>
                      </div>
                      <Button
                        buttonType="negative"
                        buttonSize="xs"
                        onClick={() => handleRemoveConfiguration(index)}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <Button
                fullWidth
                buttonType="primary"
                buttonSize="m"
                onClick={handleSave}
                disabled={isSaving || !hasConfigurationChanged}
                style={{ marginTop: 'var(--spacing-l)' }}
              >
                {isSaving ? 'Saving...' : 'Save Configuration'}
              </Button>
            </FieldGroup>
          </Section>

          <Section title="Mass Locale Duplication">
            <FieldGroup>
              <div
                style={{
                  backgroundColor: 'var(--color--surface-muted)',
                  padding: 'var(--spacing-m)',
                  borderRadius: '4px',
                  marginBottom: 'var(--spacing-m)',
                }}
              >
                <p
                  style={{
                    margin: '0 0 var(--spacing-s) 0',
                    fontSize: 'var(--font-size-s)',
                  }}
                >
                  Need to duplicate content across all records in a model? Use
                  the Mass Locale Duplication feature to copy all content from
                  one locale to another in bulk. This is useful for setting up
                  new locales or creating baseline translations.
                </p>
                <p
                  style={{
                    margin: '0',
                    fontSize: 'var(--font-size-s)',
                    color: 'var(--color--ink-subtle)',
                  }}
                >
                  <strong>Note:</strong> Mass duplication will overwrite all
                  existing content in the target locale.
                </p>
              </div>

              <Button
                fullWidth
                buttonType="muted"
                buttonSize="m"
                onClick={handleNavigateToMassDuplication}
              >
                Go to Mass Locale Duplication
              </Button>
            </FieldGroup>
          </Section>
        </Form>
      </Canvas>
    </ErrorBoundary>
  );
}
