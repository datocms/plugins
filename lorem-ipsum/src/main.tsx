import { connect, type FieldDropdownActionsCtx, type ExecuteFieldDropdownActionCtx } from 'datocms-plugin-sdk';
import { render } from './utils/render';
import ConfigScreen from './entrypoints/ConfigScreen';
import 'datocms-react-ui/styles.css';
import generateDummyText from './utils/generateDummyText';

connect({
  renderConfigScreen(ctx) {
    return render(<ConfigScreen ctx={ctx} />);
  },
  fieldDropdownActions(field, _ctx: FieldDropdownActionsCtx) {
    // Apply the dropdown action to fields of type string, text, or structured_text
    if (['string', 'text', 'structured_text'].includes(field.attributes.field_type)) {
      return [{
        id: "loremIpsum",
        label: "Generate Lorem Ipsum",
        icon: "font"
      }];
    }
    return [];
  },
  async executeFieldDropdownAction(actionId, ctx: ExecuteFieldDropdownActionCtx) {
    if (actionId === "loremIpsum") {
      const generated = generateDummyText(ctx.field);
      await ctx.setFieldValue(ctx.fieldPath, generated);
      ctx.notice("Lorem Ipsum generated!");
    }
  },
});