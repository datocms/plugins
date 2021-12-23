import {
  connect,
  Field,
  RenderItemFormSidebarPanelCtx,
} from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import ConfigScreen from './entrypoints/ConfigScreen';
import FieldAnchorMenu from './entrypoints/SidebarPanel';
import {
  isValidGlobalParams,
  normalizeGlobalParams,
} from './utils/globalParams';
import { render } from './utils/render';

connect({
  async onBoot(ctx) {
    if (isValidGlobalParams(ctx.plugin.attributes.parameters)) {
      return;
    }

    if (!ctx.currentRole.meta.final_permissions.can_edit_schema) {
      return;
    }

    const fields = await ctx.loadFieldsUsingPlugin();

    const upgradedFields = (
      await Promise.all(
        fields.map(async (field) => {
          if (field.attributes.appearance.editor === ctx.plugin.id) {
            await ctx.updateFieldAppearance(field.id, [
              {
                operation: 'removeEditor',
              },
            ]);
            return field;
          }

          return false;
        }),
      )
    ).filter((field): field is Field => !!field);

    ctx.updatePluginParameters(
      normalizeGlobalParams(ctx.plugin.attributes.parameters),
    );

    if (upgradedFields.length > 0) {
      for (let i = 0; i < upgradedFields.length; i++) {
        const field = upgradedFields[i];
        const itemType = ctx.itemTypes[field.relationships.item_type.data.id]!;

        const result = await ctx.customToast({
          type: 'warning',
          message:
            i === 0
              ? `Plugin upgraded successfully, you can now remove ${upgradedFields.length} fields. Go to the first one and remove it!`
              : `Great! ${upgradedFields.length - i} more to remove:`,
          dismissOnPageChange: false,
          dismissAfterTimeout: false,
          cta: {
            label: `${itemType.attributes.name} > ${field.attributes.label}`,
            value: 'remove',
          },
        });

        if (result === 'remove') {
          ctx.navigateTo(`/admin/item_types/${itemType.id}#f${field.id}`);
        } else {
          break;
        }
      }
    }
  },
  renderConfigScreen(ctx) {
    render(<ConfigScreen ctx={ctx} />);
  },
  itemFormSidebarPanels(itemType, ctx) {
    const params = normalizeGlobalParams(ctx.plugin.attributes.parameters);

    if (itemType.relationships.fields.data.length < params.minFieldsToShow) {
      return [];
    }

    return [
      {
        id: 'fieldAnchorMenu',
        label: 'Scroll to field',
        startOpen: params.startOpen,
        placement: ['after', 'info'],
      },
    ];
  },
  renderItemFormSidebarPanel(
    sidebarPanelId,
    ctx: RenderItemFormSidebarPanelCtx,
  ) {
    render(<FieldAnchorMenu ctx={ctx} />);
  },
});
