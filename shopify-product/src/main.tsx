import { connect } from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import './kit-fixes.css';
import {
  FIELD_EXTENSION_ID,
  FIELD_EXTENSION_INITIAL_HEIGHT,
  PICKER_MODAL_ID,
} from './constants';
import {
  normalizePluginParameters,
  validateFieldParameters,
} from './lib/parameters';
import { matchesAutoApplyPattern } from './utils/autoApply';
import { bootPlugin } from './utils/boot';
import { mount } from './utils/mount';

const SUPPORTED_FIELD_TYPES = ['string', 'json'];

// Screens load on demand (see utils/mount.ts): keep static imports here to
// what the hidden hooks iframe needs.
connect({
  onBoot: bootPlugin,

  renderConfigScreen(ctx) {
    mount(import('./entrypoints/ConfigScreen'), ctx);
  },

  manualFieldExtensions() {
    return [
      {
        id: FIELD_EXTENSION_ID,
        name: 'Shopify',
        type: 'editor',
        fieldTypes: ['string', 'json'],
        // About a new JSON field's settings (string fields ~750, 1.x JSON ~1300).
        configurable: { initialHeight: 1000 },
        initialHeight: FIELD_EXTENSION_INITIAL_HEIGHT,
      },
    ];
  },

  validateManualFieldExtensionParameters(fieldExtensionId, parameters) {
    if (fieldExtensionId !== FIELD_EXTENSION_ID) return {};
    return validateFieldParameters(parameters);
  },

  renderManualFieldExtensionConfigScreen(fieldExtensionId, ctx) {
    if (fieldExtensionId === FIELD_EXTENSION_ID) {
      mount(import('./entrypoints/FieldConfigScreen'), ctx);
    }
  },

  overrideFieldExtensions(field, ctx) {
    if (!SUPPORTED_FIELD_TYPES.includes(field.attributes.field_type)) {
      return;
    }

    // A field set up manually with this plugin keeps its own settings.
    if (field.attributes.appearance.editor === ctx.plugin.id) {
      return;
    }

    const { autoApplyToFieldsWithApiKey } = normalizePluginParameters(
      ctx.plugin.attributes.parameters,
    );

    if (
      !matchesAutoApplyPattern(
        autoApplyToFieldsWithApiKey,
        field.attributes.api_key,
      )
    ) {
      return;
    }

    // No parameters: auto-applied fields keep the 1.x defaults.
    return {
      editor: {
        id: FIELD_EXTENSION_ID,
        initialHeight: FIELD_EXTENSION_INITIAL_HEIGHT,
      },
    };
  },

  // Any extension ID: fields saved by very old versions may still carry a
  // different one until a schema editor's onBoot upgrades them.
  renderFieldExtension(_fieldExtensionId, ctx) {
    mount(import('./entrypoints/FieldExtension'), ctx);
  },

  renderModal(modalId, ctx) {
    if (modalId === PICKER_MODAL_ID) {
      mount(import('./entrypoints/PickerModal'), ctx);
    }
  },
});
