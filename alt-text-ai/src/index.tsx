import ConfigScreen from './entrypoints/ConfigScreen';
import { render } from './utils/render';
import 'datocms-react-ui/styles.css';
import { connect, type DropdownAction, type Field } from 'datocms-plugin-sdk';
import get from 'lodash/get';
import {
  type AltGenerationMode,
  hasGeneratableFieldValue,
  runAltGenerationForField,
  runAltGenerationForUploads,
} from './services/altTextGeneration';

const GENERATE_MISSING_ALTS_ACTION_ID = 'generate-missing-alts';
const REGENERATE_ALL_ALTS_ACTION_ID = 'regenerate-all-alts';

const ACTION_ID_TO_MODE: Record<string, AltGenerationMode> = {
  [GENERATE_MISSING_ALTS_ACTION_ID]: 'missing-only',
  [REGENERATE_ALL_ALTS_ACTION_ID]: 'overwrite-all',
};

function isMediaField(field: Field): boolean {
  return (
    field.attributes.field_type === 'gallery' ||
    field.attributes.field_type === 'file'
  );
}

function altGenerationActions(disabled = false): DropdownAction[] {
  return [
    {
      id: GENERATE_MISSING_ALTS_ACTION_ID,
      label: 'Generate missing alt texts',
      icon: 'magic',
      disabled,
    },
    {
      id: REGENERATE_ALL_ALTS_ACTION_ID,
      label: 'Regenerate all alt texts',
      icon: 'images',
      disabled,
    },
  ];
}

connect({
  renderConfigScreen(ctx) {
    return render(<ConfigScreen ctx={ctx} />);
  },

  fieldDropdownActions(field, ctx) {
    if (!isMediaField(field)) {
      return [];
    }

    const currentFieldValue = get(ctx.formValues, ctx.fieldPath);
    const hasValue = hasGeneratableFieldValue(currentFieldValue);

    return altGenerationActions(!hasValue || ctx.disabled);
  },

  async executeFieldDropdownAction(actionId, ctx) {
    const mode = ACTION_ID_TO_MODE[actionId];
    if (!mode) {
      return;
    }

    await runAltGenerationForField(ctx, mode);
  },

  uploadsDropdownActions() {
    return altGenerationActions();
  },

  async executeUploadsDropdownAction(actionId, uploads, ctx) {
    const mode = ACTION_ID_TO_MODE[actionId];
    if (!mode) {
      return;
    }

    await runAltGenerationForUploads(ctx, uploads, mode);
  },
});
