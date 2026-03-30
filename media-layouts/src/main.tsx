import { connect } from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import ConfigScreen from './entrypoints/ConfigScreen';
import FieldConfigScreen from './entrypoints/FieldConfigScreen';
import MediaLayoutsField from './entrypoints/MediaLayoutsField';
import { render } from './utils/render';
import { ASPECT_RATIO_OPTIONS, FIELD_EXTENSION_ID } from './constants';
import { validateCustomAspectRatio } from './utils/aspectRatio';
import { isValidWidthNumber, isWidthValue } from './utils/width';
import {
  isValidGlobalParams,
  normalizeGlobalParams,
} from './utils/fieldParams';

connect({
  async onBoot(ctx) {
    if (!ctx.currentRole.meta.final_permissions.can_edit_schema) {
      return;
    }

    if (isValidGlobalParams(ctx.plugin.attributes.parameters)) {
      return;
    }

    const validParams = normalizeGlobalParams(ctx.plugin.attributes.parameters);
    ctx.updatePluginParameters(validParams);
  },

  renderConfigScreen(ctx) {
    render(<ConfigScreen ctx={ctx} />);
  },

  manualFieldExtensions() {
    return [
      {
        id: FIELD_EXTENSION_ID,
        name: 'Media Layouts',
        type: 'editor',
        fieldTypes: ['json'],
        configurable: true,
      },
    ];
  },

  renderManualFieldExtensionConfigScreen(fieldExtensionId, ctx) {
    if (fieldExtensionId === FIELD_EXTENSION_ID) {
      render(<FieldConfigScreen ctx={ctx} />);
    }
  },

  validateManualFieldExtensionParameters(fieldExtensionId, parameters) {
    if (fieldExtensionId === FIELD_EXTENSION_ID) {
      const errors: Record<string, string> = {};
      const presetAspectRatioValues = new Set(
        ASPECT_RATIO_OPTIONS.map((opt) => opt.value)
      );
      const setLayoutError = (message: string) => {
        if (!errors.layoutConfig) {
          errors.layoutConfig = message;
        }
      };

      const validModes = ['single', 'multiple', 'layout'];
      if (!parameters.mode || !validModes.includes(parameters.mode as string)) {
        errors.mode = 'Please select a mode';
      }

      // Validate layout mode specific parameters
      if (parameters.mode === 'layout') {
        const layoutConfig = parameters.layoutConfig as
          | {
              slots?: unknown[];
              columns?: number;
              layoutStyle?: unknown;
              layoutAspectRatio?: unknown;
              layoutCustomAspectRatio?: unknown;
              layoutWidth?: unknown;
            }
          | undefined;

        if (!layoutConfig || !Array.isArray(layoutConfig.slots)) {
          errors.layoutConfig = 'Layout configuration is required';
        } else if (layoutConfig.slots.length === 0) {
          errors.layoutConfig = 'At least one slot is required';
        } else {
          // Validate each slot
          const slotIds = new Set<string>();
          for (let i = 0; i < layoutConfig.slots.length; i++) {
            const slot = layoutConfig.slots[i] as Record<string, unknown>;

            if (!slot.label || typeof slot.label !== 'string' || !slot.label.trim()) {
              errors[`slot_${i}_label`] = `Slot ${i + 1}: Label is required`;
            }

            if (slot.id && typeof slot.id === 'string') {
              if (slotIds.has(slot.id)) {
                errors.layoutConfig = 'Slot IDs must be unique';
              }
              slotIds.add(slot.id);
            }

            if (
              slot.rowSpan !== undefined &&
              (typeof slot.rowSpan !== 'number' || slot.rowSpan < 1)
            ) {
              errors[`slot_${i}_rowSpan`] = `Slot ${i + 1}: Row span must be 1 or more`;
            }

            if (
              slot.colSpan !== undefined &&
              (typeof slot.colSpan !== 'number' || slot.colSpan < 1)
            ) {
              errors[`slot_${i}_colSpan`] = `Slot ${i + 1}: Column span must be 1 or more`;
            }

            if (
              slot.autoSpan !== undefined &&
              typeof slot.autoSpan !== 'boolean'
            ) {
              errors[`slot_${i}_autoSpan`] = `Slot ${i + 1}: Auto size must be true or false`;
            }

            if (typeof slot.aspectRatio === 'string') {
              if (slot.aspectRatio === 'custom') {
                const customAspectRatio =
                  typeof slot.customAspectRatio === 'string'
                    ? slot.customAspectRatio
                    : '';
                const error = validateCustomAspectRatio(customAspectRatio);
                if (error) {
                  setLayoutError(`Slot ${i + 1}: ${error}`);
                }
              } else if (!presetAspectRatioValues.has(slot.aspectRatio)) {
                const error = validateCustomAspectRatio(slot.aspectRatio);
                if (error) {
                  setLayoutError(`Slot ${i + 1}: ${error}`);
                }
              }
            }

            if (slot.width !== undefined && !isWidthValue(slot.width)) {
              setLayoutError(`Slot ${i + 1}: Width must be a number or original`);
            }
          }

          if (
            layoutConfig.layoutStyle !== undefined &&
            layoutConfig.layoutStyle !== 'grid' &&
            layoutConfig.layoutStyle !== 'masonry'
          ) {
            errors.layoutConfig = 'Layout style must be grid or masonry';
          }

          if (
            layoutConfig.layoutAspectRatio !== undefined &&
            typeof layoutConfig.layoutAspectRatio !== 'string'
          ) {
            setLayoutError('Layout aspect ratio must be a string');
          }

          if (
            layoutConfig.layoutCustomAspectRatio !== undefined &&
            typeof layoutConfig.layoutCustomAspectRatio !== 'string'
          ) {
            setLayoutError('Layout custom aspect ratio must be a string');
          }

          if (layoutConfig.layoutAspectRatio === 'custom') {
            const customAspectRatio =
              typeof layoutConfig.layoutCustomAspectRatio === 'string'
                ? layoutConfig.layoutCustomAspectRatio
                : '';
            const error = validateCustomAspectRatio(customAspectRatio);
            if (error) {
              setLayoutError(`Layout custom aspect ratio: ${error}`);
            }
          }

          if (layoutConfig.layoutWidth !== undefined) {
            const width = Number(layoutConfig.layoutWidth);
            if (!isValidWidthNumber(width)) {
              setLayoutError('Layout width must be between 1 and 10000');
            }
          }
        }
      } else {
        // Validate single/multiple mode parameters
        if (
          parameters.overrideDefaultWidth !== undefined &&
          parameters.overrideDefaultWidth !== null
        ) {
          const width = Number(parameters.overrideDefaultWidth);
          if (
            parameters.overrideDefaultWidth !== 'original' &&
            !isValidWidthNumber(width)
          ) {
            errors.overrideDefaultWidth = 'Width must be between 1 and 10000';
          }
        }
      }

      return errors;
    }
    return {};
  },

  renderFieldExtension(fieldExtensionId, ctx) {
    if (fieldExtensionId === FIELD_EXTENSION_ID) {
      render(<MediaLayoutsField ctx={ctx} />);
    }
  },
});
