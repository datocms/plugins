# Disabled field

A simple plugin that allows you to disable a field that you don't want anyone
to edit.

You can apply this plugin to every type of field.

## Configuration

1. Open the field settings and go to the **Presentation** tab.
2. Add the **Disabled Field** add-on. The field becomes read-only for editors.
3. To lock a localized field only in some locales, select them in **Disable only in these locales**.

If you leave the locale list empty, the add-on disables the field in all locales.
Fields that use the add-on from older versions keep this behaviour.

The add-on ignores the locale list on non-localized fields and always disables them.

## Limitations

The add-on only locks the field in the editing UI. API writes and other plugins
can still change the value. For server-side enforcement, restrict locales per
role in **Settings > Roles**.
