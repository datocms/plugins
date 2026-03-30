/**
 * Configuration screen for the Locale Duplicate plugin.
 * Allows users to select which fields should display copy buttons
 * in the record editing interface.
 */
import { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { Canvas, Button, SelectField, Form, FieldGroup, Section, Spinner } from 'datocms-react-ui';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { buildClient } from '@datocms/cma-client-browser';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { 
  FieldCopyConfig, 
  ModelOption, 
  FieldOption, 
  getErrorMessage
} from '../types';

/**
 * Main configuration screen component.
 * Manages field configurations and provides access to mass duplication feature.
 */
export default function ConfigScreen({ ctx }: { ctx: RenderConfigScreenCtx }) {
  const [selectedModel, setSelectedModel] = useState<ModelOption | null>(null);
  const [selectedField, setSelectedField] = useState<FieldOption | null>(null);
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [availableFields, setAvailableFields] = useState<FieldOption[]>([]);
  const [savedConfigs, setSavedConfigs] = useState<FieldCopyConfig[]>([]);
  const [originalConfigs, setOriginalConfigs] = useState<FieldCopyConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingFields, setIsLoadingFields] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  /**
   * Load saved configurations and fetch available models on component mount
   */
  useEffect(() => {
    const loadData = async () => {
      try {
        // Load saved configurations from plugin parameters
        const configs = ctx.plugin.attributes.parameters?.fieldConfigs;
        const configArray = Array.isArray(configs) ? configs : [];
        setSavedConfigs(configArray);
        setOriginalConfigs(configArray);

        // Initialize DatoCMS Content Management API client
        const client = buildClient({
          apiToken: ctx.currentUserAccessToken || '',
          environment: ctx.environment,
        });

        // Fetch all models (excluding modular blocks)
        const models = await client.itemTypes.list();
        const modelOptions = models
          .filter(model => !model.modular_block)
          .map(model => ({
            label: model.name,
            value: model.id
          }));
        
        setAvailableModels(modelOptions);
        setIsLoading(false);
      } catch (error) {
        console.error('Error loading data:', error);
        ctx.notice(`Error loading data: ${getErrorMessage(error)}`);
        setIsLoading(false);
      }
    };

    loadData();
  }, [ctx]);

  /**
   * Load available fields when a model is selected.
   * Only shows localized fields that aren't already configured.
   */
  useEffect(() => {
    const loadFields = async () => {
      if (!selectedModel) {
        setAvailableFields([]);
        setIsLoadingFields(false);
        return;
      }

      setIsLoadingFields(true);
      try {
        const client = buildClient({
          apiToken: ctx.currentUserAccessToken || '',
          environment: ctx.environment,
        });

        // Fetch fields for the selected model
        const fields = await client.fields.list(selectedModel.value);
        
        // Filter only localized fields and exclude already configured fields
        const configuredFieldIds = savedConfigs
          .filter(config => config.modelId === selectedModel.value)
          .map(config => config.fieldId);
        
        const fieldOptions = fields
          .filter(field => field.localized && !configuredFieldIds.includes(field.id))
          .map(field => ({
            label: field.label,
            value: field.id
          }));
        
        setAvailableFields(fieldOptions);
      } catch (error) {
        console.error('Error loading fields:', error);
        ctx.notice(`Error loading fields: ${getErrorMessage(error)}`);
      } finally {
        setIsLoadingFields(false);
      }
    };

    loadFields();
  }, [selectedModel, savedConfigs, ctx]);

  /**
   * Add a new field configuration to the list
   */
  const handleAddConfiguration = useCallback(() => {
    if (!selectedModel || !selectedField) {
      ctx.notice('Please select both a model and a field');
      return;
    }

    // Check if this configuration already exists
    const exists = savedConfigs.some(
      config => config.modelId === selectedModel.value && config.fieldId === selectedField.value
    );

    if (exists) {
      ctx.notice('This configuration already exists');
      return;
    }

    // Add new configuration
    setSavedConfigs([...savedConfigs, {
      modelId: selectedModel.value,
      modelLabel: selectedModel.label,
      fieldId: selectedField.value,
      fieldLabel: selectedField.label
    }]);

    // Reset selections
    setSelectedModel(null);
    setSelectedField(null);
  }, [selectedModel, selectedField, savedConfigs, ctx]);

  /**
   * Remove a field configuration from the list
   */
  const handleRemoveConfiguration = useCallback((index: number) => {
    const newConfigs = savedConfigs.filter((_, i) => i !== index);
    setSavedConfigs(newConfigs);
  }, [savedConfigs]);

  /**
   * Save all field configurations to the plugin parameters
   */
  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      await ctx.updatePluginParameters({
        ...ctx.plugin.attributes.parameters,
        fieldConfigs: savedConfigs
      });
      
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
      return !original || 
        config.modelId !== original.modelId || 
        config.fieldId !== original.fieldId;
    });
  }, [savedConfigs, originalConfigs]);

  /**
   * Get model name by ID for display purposes
   */
  const getModelName = useCallback((modelId: string) => {
    const model = availableModels.find(m => m.value === modelId);
    return model?.label || modelId;
  }, [availableModels]);

  /**
   * Handle model selection change
   */
  const handleModelChange = useCallback((newValue: ModelOption | null) => {
    setSelectedModel(newValue);
    setSelectedField(null);
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
    ctx.navigateTo(`/configuration/p/${ctx.plugin.id}/pages/massLocaleDuplication`);
  }, [ctx]);

  if (isLoading) {
    return (
      <Canvas ctx={ctx}>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center', 
          minHeight: '200px' 
        }}>
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
              Configure which fields should have copy buttons in the record editing interface. 
              Select a model and a localized field to enable the copy functionality.
            </p>

            <div style={{ display: 'flex', gap: 'var(--spacing-m)', marginBottom: 'var(--spacing-m)' }}>
              <div style={{ flex: 1 }}>
                <SelectField
                  name="model"
                  id="model"
                  label="Model"
                  hint="Select a model"
                  value={selectedModel}
                  selectInputProps={{
                    isMulti: false,
                    options: availableModels,
                  }}
                  onChange={(newValue) => handleModelChange(newValue as ModelOption | null)}
                />
              </div>

              <div style={{ flex: 1, position: 'relative' }}>
                <div style={{ 
                  opacity: isLoadingFields ? 0.6 : 1,
                  transition: 'opacity 0.2s ease',
                  pointerEvents: isLoadingFields ? 'none' : 'auto'
                }}>
                  <SelectField
                    name="field"
                    id="field"
                    label="Localized Field"
                    hint={isLoadingFields ? "Loading fields..." : "Select a localized field"}
                    value={selectedField}
                    selectInputProps={{
                      isDisabled: !selectedModel || isLoadingFields,
                      isMulti: false,
                      options: availableFields,
                      isLoading: isLoadingFields,
                      placeholder: isLoadingFields ? "Loading..." : "Select...",
                    }}
                    onChange={(newValue) => handleFieldChange(newValue as FieldOption | null)}
                  />
                </div>
                {isLoadingFields && (
                  <div style={{
                    position: 'absolute',
                    top: '38px',
                    right: '48px'
                  }}>
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
              <p style={{ 
                textAlign: 'center', 
                padding: 'var(--spacing-l)',
                color: 'var(--light-body-color)',
                backgroundColor: 'var(--light-bg-color)',
                borderRadius: 'var(--border-radius)'
              }}>
                No fields configured yet. Add a configuration above to get started.
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
                      backgroundColor: 'var(--light-bg-color)',
                      borderRadius: 'var(--border-radius)',
                      marginBottom: 'var(--spacing-xs)'
                    }}
                  >
                    <div>
                      <strong>{config.modelLabel || getModelName(config.modelId)}</strong>
                      <span style={{ margin: '0 var(--spacing-xs)' }}>→</span>
                      <span>{config.fieldLabel || `Field ID: ${config.fieldId}`}</span>
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
            <div style={{
              backgroundColor: 'var(--light-bg-color)',
              padding: 'var(--spacing-m)',
              borderRadius: 'var(--border-radius)',
              marginBottom: 'var(--spacing-m)'
            }}>
              <p style={{ 
                margin: '0 0 var(--spacing-s) 0',
                fontSize: 'var(--font-size-s)'
              }}>
                Need to duplicate content across all records in a model? Use the Mass Locale Duplication feature to copy all content from one locale to another in bulk. This is useful for setting up new locales or creating baseline translations.
              </p>
              <p style={{ 
                margin: '0',
                fontSize: 'var(--font-size-s)',
                color: 'var(--light-body-color)'
              }}>
                <strong>Note:</strong> Mass duplication will overwrite all existing content in the target locale.
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