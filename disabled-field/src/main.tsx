import {
  connect,
  type FieldAppearanceChange,
  type OnBootCtx,
  type RenderFieldExtensionCtx,
  type RenderManualFieldExtensionConfigScreenCtx,
} from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import FieldConfigScreen from './entrypoints/FieldConfigScreen';
import {
  normalizeDisabledLocales,
  shouldDisableField,
} from './utils/fieldParams';
import { render } from './utils/render';

const FIELD_EXTENSION_ID = 'disableField';

connect({
  async onBoot(ctx: OnBootCtx) {
    if (ctx.plugin.attributes.parameters.migratedFromLegacyPlugin) {
      return;
    }

    if (!ctx.currentRole.meta.final_permissions.can_edit_schema) {
      return;
    }

    const fields = await ctx.loadFieldsUsingPlugin();

    const someUpgraded = (
      await Promise.all(
        fields.map(async (field) => {
          const { appearance } = field.attributes;

          const changes: FieldAppearanceChange[] = [];

          appearance.addons.forEach((addon, index) => {
            if (addon.field_extension === FIELD_EXTENSION_ID) {
              return;
            }

            changes.push({
              operation: 'updateAddon',
              index,
              newFieldExtensionId: FIELD_EXTENSION_ID,
            });
          });

          if (changes.length === 0) {
            return false;
          }

          await ctx.updateFieldAppearance(field.id, changes);
        }),
      )
    ).some((x) => x);

    ctx.updatePluginParameters({
      ...ctx.plugin.attributes.parameters,
      migratedFromLegacyPlugin: true,
    });

    if (someUpgraded) {
      ctx.notice('Plugin settings upgraded successfully!');
    }
  },
  manualFieldExtensions() {
    return [
      {
        id: FIELD_EXTENSION_ID,
        name: 'Disabled Field',
        type: 'addon',
        fieldTypes: 'all',
        configurable: true,
        initialHeight: 0,
      },
    ];
  },
  renderManualFieldExtensionConfigScreen(
    _fieldExtensionId: string,
    ctx: RenderManualFieldExtensionConfigScreenCtx,
  ) {
    render(<FieldConfigScreen ctx={ctx} />);
  },
  renderFieldExtension(fieldExtensionId: string, ctx: RenderFieldExtensionCtx) {
    if (fieldExtensionId !== FIELD_EXTENSION_ID) {
      return;
    }

    if (
      shouldDisableField(
        normalizeDisabledLocales(ctx.parameters),
        ctx.locale,
        ctx.field.attributes.localized,
      )
    ) {
      ctx.disableField(ctx.fieldPath, true);
    }
  },
});
