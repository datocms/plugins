// The texts of the plugin for the `{ id, values }` messages of the
// components, in ICU syntax. Every Canvas gets this constant, so the object
// stays the same between renders. In a plural, `#` gets the number separators
// of the user's locale.
export const TEXTS = {
  'datoAgent.compatibleModels':
    '{count, plural, one {# compatible model} other {# compatible models}}',
} satisfies Record<string, string>;
