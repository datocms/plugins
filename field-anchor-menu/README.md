# Scroll to Field

A simple plugin that displays a menu on the sidebar with anchor links
to all fields in your record. Click on the link to scroll to the selected field.

## Changelog

- 0.1.14 - Fixed the "minimum number of fields" plugin setting silently reverting to the default of 5 every time. The config screen used a `TextField`, which submitted the value as a string; the runtime then failed `typeof value === 'number'` and `normalizeGlobalParams` reset it. The field now coerces the value to an integer on submit, validates that it is at least 1, and renders as a numeric input so the browser surfaces the constraint up front.