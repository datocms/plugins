# Alt Text AI

Generate alt text for image assets directly from DatoCMS `file` and `gallery` fields. Choose [AltText.ai](https://alttext.ai), OpenAI, Anthropic Claude, or Google Gemini, then review the generated text in the record form before saving it.

## Supported providers

| Provider | Required settings |
| --- | --- |
| AltText.ai | [AltText.ai API key](https://alttext.ai/account/api_keys) |
| OpenAI | [OpenAI API key](https://platform.openai.com/api-keys) and an image-input model |
| Anthropic Claude | [Anthropic API key](https://console.anthropic.com/settings/keys) and an image-input model |
| Google Gemini | [Gemini API key](https://aistudio.google.com/apikey) and an image-input model |

For direct model providers, the plugin loads every model ID returned by the provider's model-list API after an API key is entered. It does not recommend or preselect a model. Choose one that accepts image input and returns text, or enter a model ID manually.

## Configuration

1. Grant the plugin the `currentUserAccessToken` permission when installing it. The plugin needs this permission to retrieve the selected asset from the current DatoCMS environment.
2. Open the plugin settings and choose an alt text provider.
3. Enter that provider's API key.
4. For OpenAI, Anthropic, or Gemini, select or enter a vision-capable model and review the prompt template.
5. Save the settings.

The prompt template for direct model providers supports these placeholders:

- `{locale}`: the active locale in the record editor.
- `{filename}`: the asset filename, supplied as supporting context.

Keep an instruction in the prompt that asks the provider to return only the alt text. AltText.ai uses its own generation configuration rather than this prompt template.

### Existing installations

Existing installations are migrated automatically. A previously saved `apiKey` remains associated with AltText.ai, and AltText.ai remains the selected provider until you choose another one.

## Usage

The plugin adds two actions to the dropdown menu of every populated `file` and `gallery` field:

- **Generate missing alt texts** fills assets whose alt text is empty and leaves existing alt text unchanged.
- **Regenerate all alt texts** generates alt text for every asset in the field and overwrites existing values.

Generated values update the current record form; they are not saved automatically. Review the output, make any necessary edits, and save the record.

For localized fields, the plugin reads and updates only the field value for the active locale. Run the action separately in each locale that needs alt text. It does not update asset metadata globally or change other fields and records that reference the same upload.

## Security and privacy

Provider API keys are stored in the plugin parameters and used by client-side requests from the DatoCMS editor. Anyone who can run or inspect the plugin in that project may be able to retrieve those keys. Use dedicated keys with the narrowest available permissions, quotas, billing limits, and origin or API restrictions, and rotate them regularly. If your organization's policy prohibits browser-exposed credentials, do not configure a direct provider key.

The data sent depends on the selected provider. AltText.ai receives a transformed public image URL, the active locale, and a stable identifier derived from the DatoCMS upload ID. OpenAI and Anthropic receive the transformed public image URL plus the expanded prompt. Gemini receives the image bytes plus the expanded prompt. The expanded prompt contains the locale or filename only when its template includes the corresponding placeholder. Review the selected provider's data-handling terms before processing sensitive assets.

The editor's DatoCMS current-user access token is used only to retrieve upload information through the Content Management API for the current environment. It is never sent to AltText.ai, OpenAI, Anthropic, or Google.

## Limitations and accessibility notes

- The plugin is intended for image assets. Other file types are not supported and may produce a provider error.
- Direct providers require a model that accepts image input and returns text. Model availability, pricing, rate limits, and output quality depend on the provider account.
- Each asset-generation request times out after 60 seconds without changing that asset's alt text.
- AI-generated descriptions can be inaccurate. Always review them in the context where the image appears.
- Empty alt text can be intentional for decorative images. **Generate missing alt texts** cannot distinguish an intentional empty value from a missing one, so review decorative images before saving.
- A single asset can need different alt text in different contexts. The plugin updates the current field occurrence rather than every reference to the upload.

## Development

Run commands from this directory:

- `npm run dev`: start the local Vite development server.
- `npm run build`: type-check the project and build production assets into `dist/`.
- `npm run test`: run the test suite once.
- `npm run test:watch`: run tests in watch mode.
- `npm run preview`: preview the production build locally.
