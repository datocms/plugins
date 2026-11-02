import { connect } from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import Canvas from 'datocms-react-ui/Canvas';
import { ASPECT_RATIO_OPTIONS, FIELD_EXTENSION_ID } from './constants';
import ConfigScreen from './entrypoints/ConfigScreen';
import FieldConfigScreen from './entrypoints/FieldConfigScreen';
import MediaLayoutsField from './entrypoints/MediaLayoutsField';
import { validateCustomAspectRatio } from './utils/aspectRatio';
import {
  isValidGlobalParams,
  normalizeGlobalParams,
} from './utils/fieldParams';
import { slotTitle } from './utils/options';
import { render } from './utils/render';
import {
  isValidWidthNumber,
  isWidthValue,
  MAX_WIDTH,
  MIN_WIDTH,
} from './utils/width';

type LayoutConfigRaw = {
  slots?: unknown[];
  columns?: number;
  layoutStyle?: unknown;
  layoutAspectRatio?: unknown;
  layoutCustomAspectRatio?: unknown;
  layoutWidth?: unknown;
};

// "Detail: enter an aspect ratio": the message after the colon starts lower
// case, and ends with no period, as the errors of the inputs
function prefixError(prefix: string, message: string): string {
  return `${prefix}: ${message.charAt(0).toLowerCase()}${message.slice(1)}`;
}

// The name that the field settings show for the slot: its label, or
// 'Untitled slot'. The position would name no slot on the screen, which
// lists the slots row by row.
function slotName(slot: Record<string, unknown>): string {
  return slotTitle({ label: typeof slot.label === 'string' ? slot.label : '' });
}

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
      `${slotName(slot)}: the row span must be 1 or more`;
  }

  if (
    slot.colSpan !== undefined &&
    (typeof slot.colSpan !== 'number' || slot.colSpan < 1)
  ) {
    errors[`slot_${index}_colSpan`] =
      `${slotName(slot)}: the column span must be 1 or more`;
  }

  if (slot.autoSpan !== undefined && typeof slot.autoSpan !== 'boolean') {
    errors[`slot_${index}_autoSpan`] =
      `${slotName(slot)}: turn Size from aspect ratio on or off`;
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
    errors[`slot_${index}_label`] = `${slotName(slot)}: enter a label`;
  }

  if (slot.id && typeof slot.id === 'string') {
    if (slotIds.has(slot.id)) {
      errors.layoutConfig = 'Two slots have the same ID';
    }
    slotIds.add(slot.id);
  }

  validateSlotSpans(slot, index, errors);
  validateSlotAspectRatio(slot, index, presetAspectRatioValues, errors);

  if (slot.width !== undefined && !isWidthValue(slot.width)) {
    setLayoutError(
      `${slotName(slot)}: the width must be a number of pixels or Original`,
    );
  }
}

// The settings of an open slot show this error on its custom aspect ratio,
// thus it has a key of its own
function validateSlotAspectRatio(
  slot: Record<string, unknown>,
  index: number,
  presetAspectRatioValues: Set<string>,
  errors: Record<string, string>,
) {
  if (typeof slot.aspectRatio !== 'string') return;
  const key = `slot_${index}_aspectRatio`;

  if (slot.aspectRatio === 'custom') {
    const customAspectRatio =
      typeof slot.customAspectRatio === 'string' ? slot.customAspectRatio : '';
    const error = validateCustomAspectRatio(customAspectRatio);
    if (error) {
      errors[key] = prefixError(slotName(slot), error);
    }
    return;
  }

  if (!presetAspectRatioValues.has(slot.aspectRatio)) {
    const error = validateCustomAspectRatio(slot.aspectRatio);
    if (error) {
      errors[key] = prefixError(slotName(slot), error);
    }
  }
}

function validateLayoutConfigAspectRatio(
  layoutConfig: LayoutConfigRaw,
  errors: Record<string, string>,
  setLayoutError: (msg: string) => void,
) {
  if (
    layoutConfig.layoutAspectRatio !== undefined &&
    typeof layoutConfig.layoutAspectRatio !== 'string'
  ) {
    setLayoutError('The layout aspect ratio is not valid');
    return;
  }

  if (
    layoutConfig.layoutCustomAspectRatio !== undefined &&
    typeof layoutConfig.layoutCustomAspectRatio !== 'string'
  ) {
    setLayoutError('The custom layout aspect ratio is not valid');
    return;
  }

  if (layoutConfig.layoutAspectRatio === 'custom') {
    const customAspectRatio =
      typeof layoutConfig.layoutCustomAspectRatio === 'string'
        ? layoutConfig.layoutCustomAspectRatio
        : '';
    const error = validateCustomAspectRatio(customAspectRatio);
    // Its input shows the error: a key of its own keeps it out of the
    // layout error
    if (error) {
      errors.layoutAspectRatio = prefixError('Layout aspect ratio', error);
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
    errors.layoutConfig = 'Add at least one slot';
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
    errors.layoutConfig = 'The layout settings are missing';
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
    errors.layoutConfig = 'The layout style must be Grid or Masonry';
  }

  validateLayoutConfigAspectRatio(layoutConfig, errors, setLayoutError);

  if (layoutConfig.layoutWidth !== undefined) {
    const width = Number(layoutConfig.layoutWidth);
    if (!isValidWidthNumber(width)) {
      setLayoutError(`Enter a layout width from ${MIN_WIDTH} to ${MAX_WIDTH}`);
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
      errors.overrideDefaultWidth = `Enter a width from ${MIN_WIDTH} to ${MAX_WIDTH}`;
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
    errors.mode = 'Pick a mode';
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
    render(
      <Canvas ctx={ctx}>
        <ConfigScreen ctx={ctx} />
      </Canvas>,
    );
  },

  manualFieldExtensions() {
    return [
      {
        id: FIELD_EXTENSION_ID,
        name: 'Media layouts',
        type: 'editor',
        fieldTypes: ['json'],
        configurable: true,
      },
    ];
  },

  renderManualFieldExtensionConfigScreen(fieldExtensionId, ctx) {
    if (fieldExtensionId === FIELD_EXTENSION_ID) {
      render(
        <Canvas ctx={ctx}>
          <FieldConfigScreen ctx={ctx} />
        </Canvas>,
      );
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
      render(
        <Canvas ctx={ctx}>
          <MediaLayoutsField ctx={ctx} />
        </Canvas>,
      );
    }
  },
});
