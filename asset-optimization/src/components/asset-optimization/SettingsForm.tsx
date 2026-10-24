import type { RenderPageCtx } from 'datocms-plugin-sdk';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import { Page } from 'datocms-react-ui/Page';
import RadioGroupInput from 'datocms-react-ui/RadioGroupInput';
import SwitchInput from 'datocms-react-ui/SwitchInput';
import SwitchList from 'datocms-react-ui/SwitchList';
import debounce from 'lodash.debounce';
import { useEffect, useRef } from 'react';
import type { OptimizationSettings } from '../../utils/optimizationUtils';
import NumberSetting, { type NumberSettingKey } from './NumberSetting';

// Documentation URLs
const docUrls = {
  format: 'https://docs.imgix.com/apis/rendering/format/fm',
  auto: 'https://docs.imgix.com/apis/rendering/automatic',
  resize: 'https://docs.imgix.com/apis/rendering/size/w',
  quality: 'https://docs.imgix.com/apis/rendering/format/q',
  dpr: 'https://docs.imgix.com/apis/rendering/pixel-density/dpr',
  lossless: 'https://docs.imgix.com/apis/rendering/format/lossless',
  chroma: 'https://docs.imgix.com/apis/rendering/format/chroma-subsampling',
  colorSpace: 'https://docs.imgix.com/apis/rendering/format/color-space',
};

const TARGET_FORMATS = [
  { value: 'webp', label: 'WebP' },
  { value: 'avif', label: 'AVIF' },
];

type SwitchSettingKey = keyof Pick<
  OptimizationSettings,
  | 'preserveOriginalFormat'
  | 'resizeLargeImages'
  | 'useAutoCompress'
  | 'useDpr'
  | 'useLossless'
  | 'useChromaSubsampling'
  | 'preserveColorProfile'
>;

interface SettingsFormProps {
  settings: OptimizationSettings;
  onSettingsChange: (newSettings: OptimizationSettings) => void;
  ctx: RenderPageCtx;
}

type GroupProps = {
  settings: OptimizationSettings;
  onNumberChange: (name: NumberSettingKey, value: number) => void;
  onSwitchChange: (name: SwitchSettingKey) => (value: boolean | null) => void;
  onTargetFormatChange: (value: string | null) => void;
};

function ImageSizeGroup({ settings, onNumberChange }: GroupProps) {
  return (
    <Page.Group title="Image size">
      <div className="form__field form__row">
        <div className="form__row__cell">
          <NumberSetting
            name="largeAssetThreshold"
            label="Large image threshold"
            hint="Images of this size or larger are optimized."
            unit="MB"
            value={settings.largeAssetThreshold}
            onChange={onNumberChange}
          />
        </div>
        <div className="form__row__cell">
          <NumberSetting
            name="veryLargeAssetThreshold"
            label="Very large image threshold"
            hint="Images of this size or larger get the very large settings."
            unit="MB"
            value={settings.veryLargeAssetThreshold}
            onChange={onNumberChange}
          />
        </div>
      </div>
      <NumberSetting
        name="minimumReduction"
        label="Minimum size reduction"
        hint="An image is replaced only when its new file is at least this much smaller."
        unit="%"
        value={settings.minimumReduction}
        onChange={onNumberChange}
      />
    </Page.Group>
  );
}

function FormatGroup({
  settings,
  onSwitchChange,
  onTargetFormatChange,
}: GroupProps) {
  return (
    <Page.Group title="Format">
      <FieldWrapper
        hint="JPEG, PNG, GIF, WebP and AVIF images keep their format. Images in other formats are skipped."
        docs={{ label: 'Imgix fm parameter', to: docUrls.format }}
      >
        <SwitchInput
          label="Keep the original format"
          value={settings.preserveOriginalFormat}
          onChange={onSwitchChange('preserveOriginalFormat')}
        />
      </FieldWrapper>
      {!settings.preserveOriginalFormat && (
        <FieldWrapper label="Convert to">
          <RadioGroupInput
            small
            value={settings.targetFormat}
            options={TARGET_FORMATS}
            onChange={onTargetFormatChange}
          />
        </FieldWrapper>
      )}
      <FieldWrapper
        hint="Lets Imgix pick the best compression for each image (auto=compress)."
        docs={{ label: 'Imgix auto parameter', to: docUrls.auto }}
      >
        <SwitchInput
          label="Automatic compression"
          value={settings.useAutoCompress}
          onChange={onSwitchChange('useAutoCompress')}
        />
      </FieldWrapper>
    </Page.Group>
  );
}

function ResizeGroup({ settings, onNumberChange, onSwitchChange }: GroupProps) {
  return (
    <Page.Group title="Resize">
      <FieldWrapper
        hint="Scales an image down when its longer side is over the max size."
        docs={{ label: 'Imgix size parameters', to: docUrls.resize }}
      >
        <SwitchInput
          label="Resize large images"
          value={settings.resizeLargeImages}
          onChange={onSwitchChange('resizeLargeImages')}
        />
      </FieldWrapper>
      {settings.resizeLargeImages && (
        <div className="form__field form__row">
          <div className="form__row__cell">
            <NumberSetting
              name="resizeDimensionLarge"
              label="Max size of large images"
              hint="The longer side, in pixels."
              unit="px"
              value={settings.resizeDimensionLarge}
              onChange={onNumberChange}
            />
          </div>
          <div className="form__row__cell">
            <NumberSetting
              name="resizeDimensionVeryLarge"
              label="Max size of very large images"
              hint="The longer side, in pixels."
              unit="px"
              value={settings.resizeDimensionVeryLarge}
              onChange={onNumberChange}
            />
          </div>
        </div>
      )}
    </Page.Group>
  );
}

function CompressionGroup({
  settings,
  onNumberChange,
  onSwitchChange,
}: GroupProps) {
  return (
    <Page.Group title="Compression">
      <FieldWrapper
        hint={
          settings.useLossless
            ? "The quality settings don't apply while this is on."
            : 'Keeps every detail when the output format allows it.'
        }
        docs={{ label: 'Imgix lossless parameter', to: docUrls.lossless }}
      >
        <SwitchInput
          label="Lossless compression"
          value={settings.useLossless}
          onChange={onSwitchChange('useLossless')}
        />
      </FieldWrapper>
      {!settings.useLossless && (
        <div className="form__field form__row">
          <div className="form__row__cell">
            <NumberSetting
              name="qualityLarge"
              label="Large image quality"
              hint="From 0 to 100 (q). Higher keeps more detail."
              docs={{ label: 'Imgix q parameter', to: docUrls.quality }}
              value={settings.qualityLarge}
              onChange={onNumberChange}
            />
          </div>
          <div className="form__row__cell">
            <NumberSetting
              name="qualityVeryLarge"
              label="Very large image quality"
              hint="From 0 to 100 (q). Higher keeps more detail."
              value={settings.qualityVeryLarge}
              onChange={onNumberChange}
            />
          </div>
        </div>
      )}
    </Page.Group>
  );
}

function AdvancedGroup({ settings, onSwitchChange }: GroupProps) {
  return (
    <Page.Group title="Advanced">
      <SwitchList>
        <FieldWrapper
          hint="Adds dpr=2 to the images over the very large threshold."
          docs={{ label: 'Imgix dpr parameter', to: docUrls.dpr }}
        >
          <SwitchInput
            label="Double pixel density for very large images"
            value={settings.useDpr}
            onChange={onSwitchChange('useDpr')}
          />
        </FieldWrapper>
        <FieldWrapper
          hint="Uses 4:4:4 chroma subsampling (chromasub=444) for JPEG images."
          docs={{ label: 'Imgix chromasub parameter', to: docUrls.chroma }}
        >
          <SwitchInput
            label="Higher-quality chroma subsampling"
            value={settings.useChromaSubsampling}
            onChange={onSwitchChange('useChromaSubsampling')}
          />
        </FieldWrapper>
        <FieldWrapper
          hint="Keeps the color profile of the original (cs=origin), so colors stay accurate."
          docs={{ label: 'Imgix cs parameter', to: docUrls.colorSpace }}
        >
          <SwitchInput
            label="Keep color profiles"
            value={settings.preserveColorProfile}
            onChange={onSwitchChange('preserveColorProfile')}
          />
        </FieldWrapper>
      </SwitchList>
    </Page.Group>
  );
}

/**
 * The optimization settings, one group per topic. Every change saves itself
 * in the plugin parameters, 500 ms after the last one.
 */
const SettingsForm = ({
  settings,
  onSettingsChange,
  ctx,
}: SettingsFormProps) => {
  // Create debounced function for saving settings to plugin parameters
  const debouncedSaveSettings = useRef<
    ((settings: OptimizationSettings) => void) | null
  >(null);

  // Update the plugin parameters when settings change
  useEffect(() => {
    debouncedSaveSettings.current = debounce(
      async (newSettings: OptimizationSettings) => {
        try {
          // Save settings to the plugin parameters
          await ctx.updatePluginParameters({
            optimization_settings: JSON.stringify(newSettings),
          });
        } catch (error) {
          console.error('Error saving settings:', error);
        }
      },
      500,
    ); // 500ms debounce

    return () => {
      // Cancel any pending debounced calls when component unmounts
      if (debouncedSaveSettings.current) {
        // @ts-expect-error - debounce cancel method is not in types
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

  const groupProps: GroupProps = {
    settings,
    onNumberChange: (name, value) =>
      onSettingsChange({ ...settings, [name]: value }),
    onSwitchChange: (name) => (value) =>
      onSettingsChange({ ...settings, [name]: value === true }),
    onTargetFormatChange: (value) => {
      if (value) onSettingsChange({ ...settings, targetFormat: value });
    },
  };

  return (
    <>
      <ImageSizeGroup {...groupProps} />
      <FormatGroup {...groupProps} />
      <ResizeGroup {...groupProps} />
      <CompressionGroup {...groupProps} />
      <AdvancedGroup {...groupProps} />
    </>
  );
};

export default SettingsForm;
