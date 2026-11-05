// The texts of the plugin for the Message props of the components, in ICU
// syntax. Every Canvas gets this constant, so the object stays the same
// between renders.
export const TEXTS = {
  // The errors of the cells of the viewports and of the custom headers: the
  // list shows one line for each kind of error, and the red cells tell which
  // ones to fix
  'webPreviews.errors.required': 'Fill in the empty fields',
  'webPreviews.errors.chooseListedIcon': 'Choose an icon from the list',
  'webPreviews.errors.repeatedHeaderName': 'Use each header name once',
} satisfies Record<string, string>;
