import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Form, FieldGroup, TextField, SwitchField, Button, SelectField } from 'datocms-react-ui';
import type { OptimizationSettings } from '../../utils/optimizationUtils';
import { defaultSettings } from '../../utils/optimizationUtils';
import s from '../../entrypoints/styles.module.css';
import { useEffect, useRef } from 'react';
import debounce from 'lodash.debounce';
import type { ActionMeta, SingleValue, MultiValue } from 'react-select';
import ParamTooltip from './ParamTooltip';
import ButtonTooltip from './ButtonTooltip';

/**
 * Hint with doc link component
 */
const HintWithDocLink = ({ hint, url }: { hint: string; url: string }) => {
  const ariaLabel = `Learn more about ${hint}`;
  
  const openDocumentation = () => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <button 
      className={s.hintWithDoc}
      onClick={openDocumentation}
      type="button"
      aria-label={ariaLabel}
    >
      <span>{hint}</span>
      <span className={s.docLinkIcon}>&#x2139;</span>
    </button>
  );
};

/**
 * Regular hint without a documentation link
 */
const Hint = ({ hint }: { hint: string }) => {
  return (
    <div className={s.plainHint}>
      <span>{hint}</span>
    </div>
  );
};

// Documentation URLs
const docUrls = {
  format: 'https://docs.imgix.com/apis/rendering/format/fm',
  auto: 'https://docs.imgix.com/apis/rendering/automatic',
  resize: 'https://docs.imgix.com/apis/rendering/size/w',
  quality: 'https://docs.imgix.com/apis/rendering/format/q',
  dpr: 'https://docs.imgix.com/apis/rendering/pixel-density/dpr',
  lossless: 'https://docs.imgix.com/apis/rendering/format/lossless',
  chroma: 'https://docs.imgix.com/apis/rendering/format/chroma-subsampling',
  colorSpace: 'https://docs.imgix.com/apis/rendering/format/color-space'
};

interface SettingsFormProps {
  settings: OptimizationSettings;
  onSettingsChange: (newSettings: OptimizationSettings) => void;
  onStartOptimization: () => void;
  onPreviewOptimization: () => void;
  ctx: RenderPageCtx; // Added ctx to access updatePluginParameters
}

/**
 * SettingsForm component for configuring optimization settings
 * 
 * This component provides form controls for adjusting various asset optimization
 * parameters like quality, size thresholds, and format settings.
 * 
 * @param settings - Current optimization settings
 * @param onSettingsChange - Callback for when settings change
 * @param onStartOptimization - Callback for when the start button is clicked
 * @param onPreviewOptimization - Callback for when the preview button is clicked
 * @param ctx - DatoCMS SDK context
 * @returns Rendered form component
 */
const SettingsForm = ({ settings, onSettingsChange, onStartOptimization, onPreviewOptimization, ctx }: SettingsFormProps) => {
  // Create debounced function for saving settings to plugin parameters
  const debouncedSaveSettings = useRef<((settings: OptimizationSettings) => void) | null>(null);

  // Update the plugin parameters when settings change
  useEffect(() => {
    debouncedSaveSettings.current = debounce(async (newSettings: OptimizationSettings) => {
      try {
        // Save settings to the plugin parameters
        await ctx.updatePluginParameters({
          optimization_settings: JSON.stringify(newSettings)
        });
        console.log('Settings saved to plugin parameters:', newSettings);
      } catch (error) {
        console.error('Error saving settings:', error);
      }
    }, 500); // 500ms debounce

    return () => {
      // Cancel any pending debounced calls when component unmounts
      if (debouncedSaveSettings.current) {
        // @ts-ignore - debounce cancel method is not in types
        debouncedSaveSettings.current.cancel();
      }
    };
  }, [ctx]);

  // Call the debounced function whenever settings change
  useEffect(() => {
    if (debouncedSaveSettings.current) {
      debouncedSaveSettings.current(settings);
    }
  }, [settings]);

  /**
   * Handle changes to text/number input fields
   */
  const handleNumberChange = (name: keyof Pick<OptimizationSettings, 'largeAssetThreshold' | 'veryLargeAssetThreshold' | 'qualityLarge' | 'qualityVeryLarge' | 'resizeDimensionLarge' | 'resizeDimensionVeryLarge' | 'minimumReduction'>): (newValue: string) => void => (newValue) => {
    const value = Number.parseFloat(newValue);
    if (!Number.isNaN(value)) {
      // Create a new settings object to ensure proper re-rendering
      let validatedValue = value;
      
      // Quality validation: keep between 0-100
      if (name === 'qualityLarge' || name === 'qualityVeryLarge') {
        validatedValue = Math.min(Math.max(0, value), 100);
      }
      
      // Minimum reduction validation: keep between 0-100 since it's a percentage
      if (name === 'minimumReduction') {
        validatedValue = Math.min(Math.max(0, value), 100);
      }
      
      // Threshold validation: must be at least 0.1
      if (name === 'largeAssetThreshold' || name === 'veryLargeAssetThreshold') {
        validatedValue = Math.max(0.1, value);
      }
      
      // Max width validation: must be at least 1px
      if (name === 'resizeDimensionLarge' || name === 'resizeDimensionVeryLarge') {
        validatedValue = Math.max(1, value);
      }
      
      onSettingsChange({ ...settings, [name]: validatedValue });
    }
  };

  /**
   * Handle changes to switch fields
   */
  const handleSwitchChange = (name: keyof OptimizationSettings) => (value: boolean) => {
    onSettingsChange({ ...settings, [name]: value });
  };

  /**
   * Handle changes to select fields
   */
  const handleSelectChange = (name: keyof OptimizationSettings) => (
    newValue: SingleValue<{ value: string; label: string }> | MultiValue<{ value: string; label: string }>,
    _actionMeta: ActionMeta<{ value: string; label: string }>
  ) => {
    // The SelectField can return null when cleared, or an object with value
    if (newValue && typeof newValue === 'object' && !Array.isArray(newValue) && 'value' in newValue) {
      onSettingsChange({ ...settings, [name]: newValue.value });
    }
  };

  // Format options for the dropdown
  const formatOptions = [
    { label: 'WebP', value: 'webp' },
    { label: 'AVIF', value: 'avif' }
  ];
  
  // Selected format option based on current settings
  const selectedFormatOption = formatOptions.find(option => option.value === settings.targetFormat) || formatOptions[0];

  return (
    <Form className={s.settingsForm}>
      <FieldGroup>
        <h4>Size Thresholds</h4>
        <div className={s.fieldRow}>
          <div className={s.field}>
            <TextField
              id="largeAssetThreshold"
              name="largeAssetThreshold"
              label="Large Asset (MB)"
              value={settings.largeAssetThreshold.toString()}
              onChange={handleNumberChange('largeAssetThreshold')}
            />
            <Hint hint={`Assets above ${settings.largeAssetThreshold}MB will be optimized`} />
          </div>
          <div className={s.field}>
            <TextField
              id="veryLargeAssetThreshold"
              name="veryLargeAssetThreshold"
              label="Very Large Asset (MB)"
              value={settings.veryLargeAssetThreshold.toString()}
              onChange={handleNumberChange('veryLargeAssetThreshold')}
            />
            <Hint hint={`Assets above ${settings.veryLargeAssetThreshold}MB get stronger optimization`} />
          </div>
        </div>
        <div className={s.field}>
          <TextField
            id="minimumReduction"
            name="minimumReduction"
            label="Minimum Size Reduction (%)"
            value={settings.minimumReduction.toString()}
            onChange={handleNumberChange('minimumReduction')}
          />
          <Hint hint="Only replace if reduced by at least this percentage" />
        </div>
      </FieldGroup>

      <FieldGroup>
        <h4>Basic Optimization</h4>
        <div className={s.fieldRow}>
          <div className={s.field}>
            <ParamTooltip paramName="fm" paramValue={settings.preserveOriginalFormat ? undefined : settings.targetFormat}>
              <SwitchField
                id="preserveOriginalFormat"
                name="preserveOriginalFormat"
                label="Preserve Original Format"
                value={settings.preserveOriginalFormat}
                onChange={handleSwitchChange('preserveOriginalFormat')}
              />
            </ParamTooltip>
            <HintWithDocLink hint="Keep original image format (JPG, PNG, etc.)" url={docUrls.format} />
          </div>
          <div className={s.field}>
            <ParamTooltip paramName="auto" paramValue="compress">
              <SwitchField
                id="useAutoCompress"
                name="useAutoCompress"
                label="Auto Compress"
                value={settings.useAutoCompress}
                onChange={handleSwitchChange('useAutoCompress')}
              />
            </ParamTooltip>
            <HintWithDocLink hint="Use Imgix's auto compression features" url={docUrls.auto} />
          </div>
        </div>

        {!settings.preserveOriginalFormat && (
          <div className={s.field}>
            <ParamTooltip paramName="fm" paramValue={settings.targetFormat}>
              <SelectField
                id="targetFormat"
                name="targetFormat"
                label="Target Format"
                value={selectedFormatOption}
                onChange={handleSelectChange('targetFormat')}
                selectInputProps={{
                  options: formatOptions
                }}
              />
            </ParamTooltip>
            <Hint hint="Format to convert images to" />
          </div>
        )}
        
        <p className={s.infoText}>
          <strong>Format Settings:</strong> {settings.preserveOriginalFormat 
            ? "Original image formats will be preserved while optimizing quality and file size." 
            : `Images will be converted to ${settings.targetFormat.toUpperCase()} format for better compression.`
          }
          {settings.useAutoCompress && <span> Auto compression is enabled, letting Imgix automatically optimize each image.</span>}
        </p>

        <div className={s.fieldRow}>
          <div className={s.field}>
            <ParamTooltip paramName="max-w" paramValue={settings.resizeLargeImages ? 'value' : undefined}>
              <SwitchField
                id="resizeLargeImages"
                name="resizeLargeImages"
                label="Resize Large Images"
                value={settings.resizeLargeImages}
                onChange={handleSwitchChange('resizeLargeImages')}
              />
            </ParamTooltip>
            <HintWithDocLink hint="Reduce image dimensions to save space" url={docUrls.resize} />
          </div>
        </div>
      </FieldGroup>
      
      {settings.resizeLargeImages && (
        <FieldGroup>
          <h4>Resize Dimensions</h4>
          <div className={s.fieldRow}>
            <div className={s.field}>
              <ParamTooltip paramName="max-w" paramValue={settings.resizeDimensionLarge}>
                <TextField
                  id="resizeDimensionLarge"
                  name="resizeDimensionLarge"
                  label="Large Image Max Width (px)"
                  value={settings.resizeDimensionLarge.toString()}
                  onChange={handleNumberChange('resizeDimensionLarge')}
                />
              </ParamTooltip>
              <Hint hint="Max dimension for large images" />
            </div>
            <div className={s.field}>
              <ParamTooltip paramName="max-w" paramValue={settings.resizeDimensionVeryLarge}>
                <TextField
                  id="resizeDimensionVeryLarge"
                  name="resizeDimensionVeryLarge"
                  label="Very Large Image Max Width (px)"
                  value={settings.resizeDimensionVeryLarge.toString()}
                  onChange={handleNumberChange('resizeDimensionVeryLarge')}
                />
              </ParamTooltip>
              <Hint hint="Max dimension for very large images" />
            </div>
          </div>
        </FieldGroup>
      )}

      <FieldGroup>
        <h4>Compression Settings</h4>
        {!(settings.useLossless) && (
          <div className={s.fieldRow}>
            <div className={s.field}>
              <ParamTooltip paramName="q" paramValue={settings.qualityLarge}>
                <TextField
                  id="qualityLarge"
                  name="qualityLarge"
                  label="Large Image Quality"
                  value={settings.qualityLarge.toString()}
                  onChange={handleNumberChange('qualityLarge')}
                />
              </ParamTooltip>
              <HintWithDocLink hint="Quality for large images (0-100)" url={docUrls.quality} />
            </div>
            <div className={s.field}>
              <ParamTooltip paramName="q" paramValue={settings.qualityVeryLarge}>
                <TextField
                  id="qualityVeryLarge"
                  name="qualityVeryLarge"
                  label="Very Large Image Quality"
                  value={settings.qualityVeryLarge.toString()}
                  onChange={handleNumberChange('qualityVeryLarge')}
                />
              </ParamTooltip>
              <HintWithDocLink hint="Quality for very large images (0-100)" url={docUrls.quality} />
            </div>
          </div>
        )}
        {(settings.useLossless) && (
          <p className={s.infoText} style={{ marginBottom: 0 }}>
            <strong>Lossless Mode:</strong> Standard quality settings are disabled when using Lossless Mode.
          </p>
        )}
      </FieldGroup>
      
      <FieldGroup className={s.advancedOptionsGroup}>
        <h4>Advanced Options</h4>
        <div className={s.optionsGrid}>
          <div className={s.optionItem}>
            <ParamTooltip paramName="lossless" paramValue={settings.useLossless ? 1 : undefined}>
              <SwitchField
                id="useLossless"
                name="useLossless"
                label="Use Lossless Compression"
                value={settings.useLossless}
                onChange={handleSwitchChange('useLossless')}
              />
            </ParamTooltip>
            <HintWithDocLink hint="Use lossless compression when possible" url={docUrls.lossless} />
          </div>
          <div className={s.optionItem}>
            <ParamTooltip paramName="dpr" paramValue={settings.useDpr ? 2 : undefined}>
              <SwitchField
                id="useDpr"
                name="useDpr"
                label="Use DPR Optimization"
                value={settings.useDpr}
                onChange={handleSwitchChange('useDpr')}
              />
            </ParamTooltip>
            <HintWithDocLink hint="Optimize for high-resolution displays (Retina)" url={docUrls.dpr} />
          </div>
          <div className={s.optionItem}>
            <ParamTooltip paramName="chromasub" paramValue={settings.useChromaSubsampling ? 444 : undefined}>
              <SwitchField
                id="useChromaSubsampling"
                name="useChromaSubsampling"
                label="Enhanced Chroma Sampling"
                value={settings.useChromaSubsampling}
                onChange={handleSwitchChange('useChromaSubsampling')}
              />
            </ParamTooltip>
            <HintWithDocLink hint="Use higher quality chroma subsampling (444) for JPEGs" url={docUrls.chroma} />
          </div>
          <div className={s.optionItem}>
            <ParamTooltip paramName="cs" paramValue={settings.preserveColorProfile ? 'origin' : undefined}>
              <SwitchField
                id="preserveColorProfile"
                name="preserveColorProfile"
                label="Preserve Color Profiles"
                value={settings.preserveColorProfile}
                onChange={handleSwitchChange('preserveColorProfile')}
              />
            </ParamTooltip>
            <HintWithDocLink hint="Maintain accurate colors from original image" url={docUrls.colorSpace} />
          </div>
        </div>
      </FieldGroup>
      
      <div className={s.formActionContainer}>
        <div className={s.buttonGroup}>
          <Button
            buttonType="muted"
            buttonSize="l"
            onClick={() => onSettingsChange({ ...defaultSettings })}
          >
            Restore Defaults
          </Button>
          <ButtonTooltip tooltip="Calculate potential improvements with current settings without replacing any assets">
            <Button 
              buttonType="muted" 
              buttonSize="l" 
              onClick={onPreviewOptimization}
            >
              Preview Optimization
            </Button>
          </ButtonTooltip>
          <Button 
            buttonType="primary" 
            buttonSize="l" 
            onClick={onStartOptimization}
            fullWidth
          >
            Start Optimization
          </Button>
        </div>
      </div>
    </Form>
  );
};

export default SettingsForm;
