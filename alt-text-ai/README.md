# Alt Text AI

Alt Text AI is a plugin that integrates DatoCMS with [AltText.ai](https://alttext.ai) to generate image alt text directly in the DatoCMS dashboard.

## Configuration

In the plugin's settings screen, paste an API key obtained from [https://alttext.ai/account/api_keys](https://alttext.ai/account/api_keys).

The plugin also relies on the editor's current user access token, so make sure that permission is granted when installing.

## Usage

Once configured, the plugin adds two dropdown actions to every `file` and `gallery` field. Open a record and use the field-specific dropdown to run:

- **Generate missing alt texts**: only fills in alt text for assets that don't have one yet.
- **Generate Alt Texts**: regenerates alt text for every asset in the field, overwriting any existing values.

## Scripts

- `npm run dev`: Run the plugin locally with Vite.
- `npm run build`: Type-check and build production assets into `dist/`.
