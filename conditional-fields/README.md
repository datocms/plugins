# DatoCMS Conditional fields plugin

A simple plugin that shows or hides one or more target fields in the record editor based on the value of a **boolean** or **string** field.

## How it works

The plugin registers a manual field addon called **Conditional fields** that can be attached to a boolean or string field. When the field's value changes, the addon calls `ctx.toggleField` to show/hide the configured target fields. Localized source/target fields are handled correctly: if the trigger field is localized the toggle is per-locale, otherwise all locales of the target are toggled together.

## Boolean trigger

Attach the addon to a **boolean** (checkbox) field. The configuration options are:

- **Fields to be hidden/shown** — pick one or more fields from the same model that should be controlled by the checkbox.
- **Invert visibility?** — when off, target fields are visible while the checkbox is checked; when on, target fields are hidden while the checkbox is checked.

## String trigger

Attach the addon to a **string** field — most useful when the field is configured as a select (dropdown) with predefined options. The configuration options are:

- **Fields to be hidden/shown** — pick one or more fields from the same model that should be controlled by this field.
- **Show when value is** — a comma-separated list of values that make the target fields visible. Any other value (including blank) hides them.

For example, if your string field has options `cat`, `dog`, and `fish`, and you want to show a `breed` field only for `cat` and `dog`, you would enter `cat, dog`.

## Notes

- Target fields can be of any type, as long as they live on the same model as the trigger field.
- Multiple addons can be stacked on different trigger fields to compose more complex visibility logic.
