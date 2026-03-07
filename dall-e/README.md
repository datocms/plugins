# Image Generator asset source

Generate images with current OpenAI image models and insert them directly into your DatoCMS project.

## Setup

1. Install the plugin in DatoCMS.
2. Add an OpenAI API key in the plugin settings.
3. Choose the generation model in plugin settings.
4. Open the asset source, write a prompt, choose a shape, and generate an image.

## Notes

- This plugin currently supports the GPT image models exposed by the installed OpenAI SDK: `gpt-image-1.5`, `gpt-image-1`, and `gpt-image-1-mini`.
- Generation requests are sent directly from the browser to OpenAI using the configured API key.
- The asset source uses safe defaults and keeps the editor UI limited to prompt + shape.
- OpenAI image generation docs: https://platform.openai.com/docs/guides/image-generation
- API keys: https://platform.openai.com/api-keys
