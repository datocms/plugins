# AI Asset Source

![example.jpg](https://raw.githubusercontent.com/datocms/plugins/master/ai-asset-source/public/example.jpg)

This plugin is an [asset source](https://www.datocms.com/docs/plugin-sdk/asset-sources) that lets you add AI-generated images from OpenAI and Google models directly into your DatoCMS Media Area.

Requires API access from OpenAI or Google. You'll need an API key, not just a monthly ChatGPT / Gemini subscription. Some specific models may require additional ID verification from the AI provider.

## Setup

1. Install the plugin from the marketplace
2. Inside your DatoCMS project, access the Configuration screen
3. Add your provider settings, such as your API key, a model to use, and image output settings.

## Usage
1. From your Media Area, a dropdown arrow will appear next to the "+ Upload new assets" button. Click it to reveal the AI Asset Source.
2. Enter your prompt and choose the image ratio and # of variations you want. Generation can take several minutes; elapsed time is shown and requests time out after 10 minutes.
3. Thumbnails of the generated images will be shown. Select at least one to upload to your Media Area, or adjust your prompt to try again.

## Notes

- Compatible GPT Image and Gemini image models are loaded from the provider catalog. Google catalogs are fully paginated. Saved models missing from the catalog remain visible as unavailable; retired DALL·E and Imagen models cannot be generated.
- Some models, such as `gpt-image-2`, may require one-time additional ID verification from the AI provider. (This is a requirement from the AI provider itself, not DatoCMS.)
- Generation requests are sent directly from the browser to the selected provider using the configured API key
- This plugin only generates new assets from the asset source dropdown in the media area. Upload sidebar actions are not included.


## Limits, costs and large projects

The asset source generates new images; it never lists existing DatoCMS assets, records, models or nested blocks. A project with 200,000 records and 10,000 existing assets therefore does not cause a full-library scan in this plugin. Locale metadata is preserved for every project locale using the installed SDK's format.

- Generation remains one active request at a time, with up to four OpenAI images or one Google image requested. Provider quotas depend on the account/model and are enforced by the provider; these plugin limits are not quota guarantees.
- Prompts are limited to 32,000 characters. This matches the documented GPT Image prompt limit and is a defensive plugin cap for Google, whose actual input limit is token-based and enforced by its API.
- Images are limited to 16 MiB decoded, and generation responses to approximately 86 MiB. Returned data is checked for supported MIME type, base64 syntax and image signature. Valid partial results remain selectable, missing/invalid images have individual errors, and unexpected extra images produce a warning. At most four returned images are retained.
- Recent history retains at most five batches (twenty images) and a conservative 384 MiB estimate of its base64/data-URI strings. Older batches and their selection IDs are removed together. Selected images leaving history produce a notice. This budget is not a measurement or guarantee of total browser heap use; previews decode lazily.
- The plugin disables the Google SDK's default generation retries. Generation automatically retries only explicit HTTP 429 rejections with a valid `Retry-After` of at most 30 seconds, at most twice, excluding billing/daily quota failures. Network errors, server errors and malformed/empty responses are never automatically repeated because a generation may already have been charged.
- Cancel, closing the source, or the 10-minute timeout stops the local request. The provider may still complete processing and bill it. Check provider usage before retrying an uncertain request. Pricing depends on provider, model, quality, size and image count; no fixed cost estimate is inferred from a model name.
- Model discovery is read-only and safely retries transient failures up to three times, with 20-second attempt and 120-second total deadlines, a 16 MiB page response limit and explicit failure above 100 pages or 100,000 entries. It never silently presents a truncated catalog.

Selection uses the documented `ctx.select()` handoff, with duplicate-dispatch protection and explicit local failures. Its payload budget includes repeated metadata across locales; excessive selections fail before any handoff. The existing bounded selection is dispatched synchronously because the dashboard may close the source after the first resource. The SDK does not acknowledge final asset creation or expose an idempotency key. Downstream upload progress, retries, complete transfer concurrency and asset creation are controlled by the Media Area. A reliable import of thousands of images with per-asset confirmation would require a host contract change or a separately authorized CMA workflow; this plugin does not add that behavior.

Official references checked for this audit: [DatoCMS asset sources](https://www.datocms.com/docs/plugin-sdk/asset-sources), [OpenAI image generation](https://developers.openai.com/api/reference/resources/images/methods/generate), [Google image generation](https://ai.google.dev/gemini-api/docs/image-generation), [Imagen retirement](https://ai.google.dev/gemini-api/docs/imagen), [Google model pagination](https://ai.google.dev/api/models), [OpenAI model listing](https://developers.openai.com/api/reference/resources/models/methods/list), and [AI SDK retry defaults](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-image).

## Local validation

Run `npm run check` from this plugin directory for lint, TypeScript, deterministic synthetic tests and production build. Tests mock all provider requests and the DatoCMS frame; no keys, paid generation or DatoCMS mutations are required. Fixtures cover 10,000 catalog entries, 10,000 history transitions, 1,000 locales, bounded selections, partial failures, duplicate submissions, cancellation, payload limits, retries and deadlines. They do not prove production performance or successful final upload behavior in the live dashboard.

The repository's `run-checks.js` targets other named plugins and does not include this package. It also installs dependencies in those directories, so it is not applicable to this folder-only change.

Audit validation on 2026-10-02: `npm run check` passed (lint with no errors/warnings, application and test TypeScript checks, 58/58 tests, and Vite production build). Non-blocking notices remain: React test renderer deprecation, Google AI SDK v2 compatibility mode, and a 648 kB minified main bundle. No real provider generation or DatoCMS mutation was executed.
