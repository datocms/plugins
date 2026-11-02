// The texts of the plugin for the Message props of the components, in ICU:
// `#` in a plural gets the separators of the editor's locale.
export const TEXTS = {
  'aiAssetSource.creating':
    '{count, plural, one {Creating # image} other {Creating # images}}',
  'aiAssetSource.notCreated':
    "{count, plural, one {# image wasn't created} other {# images weren't created}}",
  'aiAssetSource.evicted':
    '{count, plural, one {# selected image was removed} other {# selected images were removed}}',
  'aiAssetSource.failed':
    "{count, plural, one {{provider} didn't create the image} other {{provider} didn't create the images}}",
  'aiAssetSource.uploadFailed':
    "{count, plural, one {# image couldn't be added to the Media Area} other {# images couldn't be added to the Media Area}}",
};
