import { render } from './utils/render';
import ConfigScreen from './entrypoints/ConfigScreen';
import 'datocms-react-ui/styles.css';
import { connect, type Field } from 'datocms-plugin-sdk';
import get from 'lodash/get';
import {
  hasGeneratableFieldValue,
  runAltGenerationForField,
  type AltGenerationMode,
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

    return [
      {
        id: GENERATE_MISSING_ALTS_ACTION_ID,
        label: 'Generate missing alt texts',
        icon: 'magic',
        disabled: !hasValue,
      },
      {
        id: REGENERATE_ALL_ALTS_ACTION_ID,
        label: 'Generate Alt Texts',
        icon: 'images',
        disabled: !hasValue,
      },
    ];
  },

  async executeFieldDropdownAction(actionId, ctx) {
    const mode = ACTION_ID_TO_MODE[actionId];
    if (!mode) {
      return;
    }

    await runAltGenerationForField(ctx, mode);
  },
});
