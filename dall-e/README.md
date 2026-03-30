# Image Generator asset source

Generate images with configured OpenAI or Google models and insert them directly into your DatoCMS project.

## Setup

1. Install the plugin in DatoCMS.
2. Add at least one provider API key in the plugin settings.
3. Choose the default provider and model in plugin settings.
4. Open the asset source, write a prompt, choose an aspect ratio, and generate an image.

## Notes

- OpenAI generation models: `gpt-image-1.5`, `gpt-image-1`, and `gpt-image-1-mini`.
- Google generation model: `gemini-2.5-flash-image`.
- Generation requests are sent directly from the browser to the selected provider using the configured API key.
- This plugin only generates new assets from the asset source. Upload sidebar actions are not included.
