# Repository Guidelines

## Project Structure & Module Organization
This package is a Vite + React + TypeScript DatoCMS plugin for translating localized content through external providers.

- `src/main.tsx`: registers field actions, sidebar behavior, bulk actions, modal rendering, the config screen, and the custom page.
- `src/entrypoints/Config/`: plugin settings UI, including vendor selection, prompt settings, exclusions, and feature toggles.
- `src/entrypoints/Sidebar/` and `src/components/TranslationProgressModal.tsx`: whole-record and bulk translation UI.
- `src/utils/translation/`: provider abstraction, translation core, field-specific translators, shared guards, and vendor helpers.
- `src/prompts/`: prompt templates used by translation flows.
- `src/**/*.test.ts(x)`: Vitest coverage lives next to the code it exercises.
- `dist/`: generated plugin bundle; do not edit manually.

## Build, Test, and Development Commands
Run from `ai-translations/`:
- `npm run dev`
- `npm run build`
- `npm run lint`
- `npm run lint:fix`
- `npm run test`
- `npm run test:watch`
- `npm run coverage`

## Coding Style & Naming Conventions
- This package follows the repo-wide Biome rules; it does not use ESLint.
- Keep provider-specific code inside `src/utils/translation/providers/` and route provider selection through `ProviderFactory.ts`.
- Keep field-type behavior in the translation utility layer instead of hardcoding it in entrypoints.
- Follow the existing file style in the touched area instead of normalizing unrelated formatting.

## Translation Workflow Notes
- Supported providers are currently OpenAI, Gemini, Anthropic, and DeepL.
- There are three main flows: field-level translation, whole-record translation, and bulk translation. Changes that affect one flow often also need review in the shared translation utilities.
- Prompt placeholders and locale handling are shared behavior; treat them as cross-cutting concerns, not one-off UI details.
- If you touch provider errors, batching, locale mapping, or translation routing, review the corresponding tests before finishing.

## Testing Guidelines
- Use `npm run build` as the baseline validation step.
- Add or update Vitest coverage when changing translation logic, provider selection, locale behavior, or error normalization.
- Prefer targeted unit coverage around `src/utils/translation/` over manual-only verification for core translation behavior.
