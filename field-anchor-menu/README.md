# Scroll to Field

(This plugin was formerly called "Field Anchor Menu")

A plugin that displays a sidebar panel with anchor links to all the fields of
your record. Click on a link to scroll directly to that field in the form.

The panel respects fieldsets, grouping fields under their fieldset titles, and
also handles localized fields by scrolling to the locale-specific tab.

## Configuration

The plugin exposes a config screen with two settings:

- **Show the sidebar panel for all models with at least this number of fields**
  (`minFieldsToShow`): hides the panel on small models. Defaults to `5`.
- **Start the sidebar panel open?** (`startOpen`): controls whether the panel
  is expanded by default when the record opens. Defaults to `true`.

No per-field setup is required: once installed, the panel appears automatically
in the record sidebar (after the standard info panel) for every model that
meets the minimum field count.
