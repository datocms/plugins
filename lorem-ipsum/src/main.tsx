import {
  connect,
  type ExecuteFieldDropdownActionCtx,
  type Field,
  type FieldDropdownActionsCtx,
} from 'datocms-plugin-sdk';
import ConfigScreen from './entrypoints/ConfigScreen';
import { render } from './utils/render';
import 'datocms-react-ui/styles.css';
import generateDummyText from './utils/generateDummyText';

const loremIpsumDropdownAction = [
  {
    id: 'loremIpsum',
    label: 'Generate dummy text',
    icon: 'font',
  },
] as const;

// Checks if any auto-apply rule matches the given field, returning the action if so
function checkAutoApplyRules(
  field: Field,
  pluginParams: Record<string, unknown>,
) {
  if (!Array.isArray(pluginParams.autoApplyRules)) {
    return null;
  }

  for (const rule of pluginParams.autoApplyRules) {
    const fieldTypeMatches = rule.fieldTypes?.includes(
      field.attributes.field_type,
    );
    if (!fieldTypeMatches) {
      continue;
    }
    try {
      const regex = new RegExp(rule.apiKeyRegexp);
      if (regex.test(field.attributes.api_key)) {
        return loremIpsumDropdownAction;
      }
    } catch (_e) {
      // If regex is invalid, skip this rule
    }
  }

  return null;
}

// Checks if the field has the loremIpsum addon manually applied
function hasLoremIpsumAddon(field: Field) {
  return field.attributes.appearance?.addons?.some(
    (addon) => addon.field_extension === 'loremIpsum',
  );
}

// The core plugin connection logic
connect({
  // Renders the plugin's config screen in DatoCMS
  renderConfigScreen(ctx) {
    return render(<ConfigScreen ctx={ctx} />);
  },
  // Declares which dropdown actions are available on a field, based on plugin parameters
  fieldDropdownActions(field, ctx: FieldDropdownActionsCtx) {
    const pluginParams = ctx.plugin.attributes.parameters;

    if (pluginParams) {
      const autoApplyResult = checkAutoApplyRules(
        field,
        pluginParams as Record<string, unknown>,
      );
      if (autoApplyResult) {
        return autoApplyResult;
      }
    }

    if (hasLoremIpsumAddon(field)) {
      return loremIpsumDropdownAction;
    }

    return [];
  },
  // Executes the chosen dropdown action, filling the field with dummy text
  async executeFieldDropdownAction(
    actionId,
    ctx: ExecuteFieldDropdownActionCtx,
  ) {
    if (actionId === 'loremIpsum') {
      const generated = generateDummyText(ctx.field);
      await ctx.setFieldValue(ctx.fieldPath, generated);
      ctx.notice('Dummy text successfully generated!');
    }
  },
  // Exposes a manual field extension that can be applied to text/string fields
  manualFieldExtensions() {
    return [
      {
        id: 'loremIpsum',
        name: 'Lorem Ipsum',
        type: 'addon',
        fieldTypes: ['text', 'string', 'structured_text'],
        configurable: true,
      },
    ];
  },
});
