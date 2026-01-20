import { connect } from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import ConfigScreen from './entrypoints/ConfigScreen';
import FieldConfigScreen from './entrypoints/FieldConfigScreen';
import MediaLayoutsField from './entrypoints/MediaLayoutsField';
import { render } from './utils/render';
import { FIELD_EXTENSION_ID } from './constants';
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

      const validModes = ['single', 'multiple', 'layout'];
      if (!parameters.mode || !validModes.includes(parameters.mode as string)) {
        errors.mode = 'Please select a mode';
      }

      // Validate layout mode specific parameters
      if (parameters.mode === 'layout') {
        const layoutConfig = parameters.layoutConfig as
          | { slots?: unknown[]; columns?: number }
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
          }
        }
      } else {
        // Validate single/multiple mode parameters
        if (
          parameters.overrideDefaultWidth !== undefined &&
          parameters.overrideDefaultWidth !== null
        ) {
          const width = Number(parameters.overrideDefaultWidth);
          if (isNaN(width) || width < 1 || width > 10000) {
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
