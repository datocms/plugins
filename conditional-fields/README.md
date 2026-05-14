# DatoCMS Conditional fields plugin

A simple plugin that shows or hides one or more target fields in the record editor based on the value of a boolean (checkbox) field.

You can pick multiple fields to be controlled by the same boolean, and you can optionally invert the behavior so that fields are hidden when the checkbox is checked.

## How it works

The plugin registers a manual field addon called **Conditional fields** that can be attached to any **boolean** field. When the boolean's value changes, the addon calls `ctx.toggleField` to show/hide the configured target fields. Localized source/target fields are handled correctly: if the boolean is localized the toggle is per-locale, otherwise all locales of the target are toggled together.

## How to set it up

1. In your project, edit the model that contains the boolean field you want to use as the trigger.
2. Open the boolean field's settings and go to the **Presentation** tab.
3. Under **Field add-ons**, add the **Conditional fields** add-on provided by this plugin.
4. In the add-on configuration:
   - **Fields to be hidden/shown** — pick one or more fields from the same model that should be controlled by the boolean.
   - **Invert visibility?** — when off, target fields are visible while the boolean is checked; when on, target fields are hidden while the boolean is checked.
5. Save the field. The configured fields will now show/hide live as editors toggle the boolean inside the record editor.

## Notes

- The add-on only works on **boolean** fields. Target fields can be of any type, as long as they live on the same model as the boolean.

