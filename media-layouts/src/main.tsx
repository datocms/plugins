import { connect } from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import { ASPECT_RATIO_OPTIONS, FIELD_EXTENSION_ID } from './constants';
import ConfigScreen from './entrypoints/ConfigScreen';
import FieldConfigScreen from './entrypoints/FieldConfigScreen';
import MediaLayoutsField from './entrypoints/MediaLayoutsField';
import { validateCustomAspectRatio } from './utils/aspectRatio';
import {
  isValidGlobalParams,
  normalizeGlobalParams,
} from './utils/fieldParams';
import { render } from './utils/render';
import { isValidWidthNumber, isWidthValue } from './utils/width';

type LayoutConfigRaw = {
  slots?: unknown[];
  columns?: number;
  layoutStyle?: unknown;
  layoutAspectRatio?: unknown;
  layoutCustomAspectRatio?: unknown;
  layoutWidth?: unknown;
};

function validateSlotSpans(
  slot: Record<string, unknown>,
  index: number,
  errors: Record<string, string>,
) {
  if (
    slot.rowSpan !== undefined &&
    (typeof slot.rowSpan !== 'number' || slot.rowSpan < 1)
  ) {
    errors[`slot_${index}_rowSpan`] =
      `Slot ${index + 1}: Row span must be 1 or more`;
  }

  if (
    slot.colSpan !== undefined &&
    (typeof slot.colSpan !== 'number' || slot.colSpan < 1)
  ) {
    errors[`slot_${index}_colSpan`] =
      `Slot ${index + 1}: Column span must be 1 or more`;
  }

  if (slot.autoSpan !== undefined && typeof slot.autoSpan !== 'boolean') {
    errors[`slot_${index}_autoSpan`] =
      `Slot ${index + 1}: Auto size must be true or false`;
  }
}

function validateLayoutSlot(
  slot: Record<string, unknown>,
  index: number,
  slotIds: Set<string>,
  presetAspectRatioValues: Set<string>,
  errors: Record<string, string>,
  setLayoutError: (msg: string) => void,
) {
  if (!slot.label || typeof slot.label !== 'string' || !slot.label.trim()) {
    errors[`slot_${index}_label`] = `Slot ${index + 1}: Label is required`;
  }

  if (slot.id && typeof slot.id === 'string') {
    if (slotIds.has(slot.id)) {
      errors.layoutConfig = 'Slot IDs must be unique';
    }
    slotIds.add(slot.id);
  }

  validateSlotSpans(slot, index, errors);
  validateSlotAspectRatio(slot, index, presetAspectRatioValues, setLayoutError);

  if (slot.width !== undefined && !isWidthValue(slot.width)) {
    setLayoutError(`Slot ${index + 1}: Width must be a number or original`);
  }
}

function validateSlotAspectRatio(
  slot: Record<string, unknown>,
  index: number,
  presetAspectRatioValues: Set<string>,
  setLayoutError: (msg: string) => void,
) {
  if (typeof slot.aspectRatio !== 'string') return;

  if (slot.aspectRatio === 'custom') {
    const customAspectRatio =
      typeof slot.customAspectRatio === 'string' ? slot.customAspectRatio : '';
    const error = validateCustomAspectRatio(customAspectRatio);
    if (error) {
      setLayoutError(`Slot ${index + 1}: ${error}`);
    }
    return;
  }

  if (!presetAspectRatioValues.has(slot.aspectRatio)) {
    const error = validateCustomAspectRatio(slot.aspectRatio);
    if (error) {
      setLayoutError(`Slot ${index + 1}: ${error}`);
    }
  }
}

function validateLayoutConfigAspectRatio(
  layoutConfig: LayoutConfigRaw,
  setLayoutError: (msg: string) => void,
) {
  if (
    layoutConfig.layoutAspectRatio !== undefined &&
    typeof layoutConfig.layoutAspectRatio !== 'string'
  ) {
    setLayoutError('Layout aspect ratio must be a string');
    return;
  }

  if (
    layoutConfig.layoutCustomAspectRatio !== undefined &&
    typeof layoutConfig.layoutCustomAspectRatio !== 'string'
  ) {
    setLayoutError('Layout custom aspect ratio must be a string');
    return;
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
}

function validateLayoutConfigSlots(
  slots: unknown[],
  presetAspectRatioValues: Set<string>,
  errors: Record<string, string>,
  setLayoutError: (msg: string) => void,
) {
  if (slots.length === 0) {
    errors.layoutConfig = 'At least one slot is required';
    return;
  }

  const slotIds = new Set<string>();
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i] as Record<string, unknown>;
    validateLayoutSlot(
      slot,
      i,
      slotIds,
      presetAspectRatioValues,
      errors,
      setLayoutError,
    );
  }
}

function validateLayoutMode(
  parameters: Record<string, unknown>,
  presetAspectRatioValues: Set<string>,
  errors: Record<string, string>,
) {
  const setLayoutError = (message: string) => {
    if (!errors.layoutConfig) {
      errors.layoutConfig = message;
    }
  };

  const layoutConfig = parameters.layoutConfig as LayoutConfigRaw | undefined;

  if (!layoutConfig || !Array.isArray(layoutConfig.slots)) {
    errors.layoutConfig = 'Layout configuration is required';
    return;
  }

  validateLayoutConfigSlots(
    layoutConfig.slots,
    presetAspectRatioValues,
    errors,
    setLayoutError,
  );

  if (
    layoutConfig.layoutStyle !== undefined &&
    layoutConfig.layoutStyle !== 'grid' &&
    layoutConfig.layoutStyle !== 'masonry'
  ) {
    errors.layoutConfig = 'Layout style must be grid or masonry';
  }

  validateLayoutConfigAspectRatio(layoutConfig, setLayoutError);

  if (layoutConfig.layoutWidth !== undefined) {
    const width = Number(layoutConfig.layoutWidth);
    if (!isValidWidthNumber(width)) {
      setLayoutError('Layout width must be between 1 and 10000');
    }
  }
}

function validateLegacyMode(
  parameters: Record<string, unknown>,
  errors: Record<string, string>,
) {
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

function validateFieldExtensionParameters(
  parameters: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const presetAspectRatioValues = new Set(
    ASPECT_RATIO_OPTIONS.map((opt) => opt.value),
  );

  const validModes = ['single', 'multiple', 'layout'];
  if (!parameters.mode || !validModes.includes(parameters.mode as string)) {
    errors.mode = 'Please select a mode';
  }

  if (parameters.mode === 'layout') {
    validateLayoutMode(parameters, presetAspectRatioValues, errors);
  } else {
    validateLegacyMode(parameters, errors);
  }

  return errors;
}

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
      return validateFieldExtensionParameters(
        parameters as Record<string, unknown>,
      );
    }
    return {};
  },

  renderFieldExtension(fieldExtensionId, ctx) {
    if (fieldExtensionId === FIELD_EXTENSION_ID) {
      render(<MediaLayoutsField ctx={ctx} />);
    }
  },
});
