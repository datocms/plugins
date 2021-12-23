import {
  connect,
  IntentCtx,
  OnBootCtx,
  RenderFieldExtensionCtx,
  RenderManualFieldExtensionConfigScreenCtx,
} from 'datocms-plugin-sdk';
import { render } from './utils/render';
import 'datocms-react-ui/styles.css';
import StarRatingEditor from './entrypoints/StarRatingEditor';
import FieldConfigScreen, { validate } from './entrypoints/FieldConfigScreen';
import {
  isValidGlobalParams,
  normalizeGlobalParams,
} from './utils/globalParams';
import {
  FieldParams,
  isValidFieldParams,
  normalizeFieldParams,
} from './utils/fieldParams';
import ConfigScreen from './entrypoints/ConfigScreen';

const FIELD_EXTENSION_ID = 'starRating';
const INITIAL_HEIGHT = 48;

connect({
  async onBoot(ctx: OnBootCtx) {
    if (!ctx.currentRole.meta.final_permissions.can_edit_schema) {
      return;
    }

    if (isValidGlobalParams(ctx.plugin.attributes.parameters)) {
      return;
    }

    const validGlobalParams = normalizeGlobalParams(
      ctx.plugin.attributes.parameters,
    );

    const fields = await ctx.loadFieldsUsingPlugin();

    const someUpgraded = (
      await Promise.all(
        fields.map(async (field) => {
          const { appearance } = field.attributes;

          if (
            appearance.editor === ctx.plugin.id &&
            (appearance.field_extension !== FIELD_EXTENSION_ID ||
              isValidFieldParams(appearance.parameters as FieldParams))
          ) {
            await ctx.updateFieldAppearance(field.id, [
              {
                operation: 'updateEditor',
                newFieldExtensionId: FIELD_EXTENSION_ID,
                newParameters: normalizeFieldParams(
                  appearance.parameters as FieldParams,
                  validGlobalParams,
                ),
              },
            ]);

            return true;
          }

          return false;
        }),
      )
    ).some((x) => x);

    ctx.updatePluginParameters(validGlobalParams);

    if (someUpgraded) {
      ctx.notice('Plugin settings successfully upgraded!');
    }
  },
  renderConfigScreen(ctx) {
    render(<ConfigScreen ctx={ctx} />);
  },
  manualFieldExtensions(ctx: IntentCtx) {
    return [
      {
        id: FIELD_EXTENSION_ID,
        name: 'Star rating',
        type: 'editor',
        fieldTypes: ['integer'],
        configurable: true,
        initialHeight: INITIAL_HEIGHT,
      },
    ];
  },
  overrideFieldExtensions(field, ctx) {
    const config = normalizeGlobalParams(ctx.plugin.attributes.parameters);

    if (field.attributes.field_type !== 'integer') {
      return;
    }

    if (
      !config.autoApplyToFieldsWithApiKey ||
      !new RegExp(config.autoApplyToFieldsWithApiKey).test(
        field.attributes.api_key,
      )
    ) {
      return;
    }

    return {
      editor: {
        id: FIELD_EXTENSION_ID,
        initialHeight: INITIAL_HEIGHT,
      },
    };
  },
  renderManualFieldExtensionConfigScreen(
    fieldExtensionId: string,
    ctx: RenderManualFieldExtensionConfigScreenCtx,
  ) {
    render(<FieldConfigScreen ctx={ctx} />);
  },
  validateManualFieldExtensionParameters(
    fieldExtensionId: string,
    parameters: Record<string, any>,
  ) {
    return validate(parameters);
  },
  renderFieldExtension(fieldExtensionId: string, ctx: RenderFieldExtensionCtx) {
    if (fieldExtensionId === FIELD_EXTENSION_ID) {
      return render(<StarRatingEditor ctx={ctx} />);
    }
  },
});
