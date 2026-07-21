import { connect } from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import { FIELD_EXTENSION_ID, PICKER_MODAL_ID } from './constants';
import ConfigScreen from './entrypoints/ConfigScreen';
import FieldConfigScreen from './entrypoints/FieldConfigScreen';
import FieldExtension from './entrypoints/FieldExtension';
import PickerModal from './entrypoints/PickerModal';
import type { CentraCardinality, CentraReferenceKind } from './types';
import { render } from './utils/render';

const REFERENCE_KINDS: CentraReferenceKind[] = [
  'primaryProduct',
  'variant',
  'item',
];

const CARDINALITIES: CentraCardinality[] = ['single', 'multiple'];

connect({
  renderConfigScreen(ctx) {
    render(<ConfigScreen ctx={ctx} />);
  },

  manualFieldExtensions() {
    return [
      {
        id: FIELD_EXTENSION_ID,
        name: 'Centra',
        type: 'editor',
        fieldTypes: ['json'],
        configurable: { initialHeight: 180 },
      },
    ];
  },

  validateManualFieldExtensionParameters(_fieldExtensionId, parameters) {
    const errors: Record<string, string> = {};

    if (
      parameters.paramsVersion !== '1' ||
      !REFERENCE_KINDS.includes(parameters.kind as CentraReferenceKind)
    ) {
      errors.kind = 'Choose the Centra entity this field references.';
    }

    if (!CARDINALITIES.includes(parameters.cardinality as CentraCardinality)) {
      errors.cardinality = 'Choose whether this field stores one or many references.';
    }

    return errors;
  },

  renderManualFieldExtensionConfigScreen(fieldExtensionId, ctx) {
    switch (fieldExtensionId) {
      case FIELD_EXTENSION_ID:
        render(<FieldConfigScreen ctx={ctx} />);
        break;
    }
  },

  renderFieldExtension(fieldExtensionId, ctx) {
    switch (fieldExtensionId) {
      case FIELD_EXTENSION_ID:
        render(<FieldExtension ctx={ctx} />);
        break;
    }
  },

  renderModal(modalId, ctx) {
    switch (modalId) {
      case PICKER_MODAL_ID:
        render(<PickerModal ctx={ctx} />);
        break;
    }
  },
});
