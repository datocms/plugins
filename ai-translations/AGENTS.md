# Repository Guidelines

## Project Structure & Module Organization
This package is a Vite + React + TypeScript DatoCMS plugin for translating localized content through external providers.

- `src/main.tsx`: registers field actions, sidebar behavior, bulk actions, modal rendering, the config screen, and the custom page.
- `src/entrypoints/Config/`: plugin settings UI, including vendor selection, prompt settings, exclusions, and feature toggles.
- `src/entrypoints/Sidebar/` (whole-record) and `src/entrypoints/CustomPage/AIBulkTranslationsPage.tsx` (bulk page) host the translation UIs; shared modals and pickers live in `src/components/` (`AITranslationsPickerModal`, `TranslationConfirmModal`, `TranslationProgressModal`) and `src/components/BulkTranslations/` (`ModelFieldPicker`, chip renderers).
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

## UI & Modals
- Style plugin UI with the semantic `--color--*` Canvas tokens so it follows the user's light/dark theme. Do not use the deprecated legacy tokens (`--base-body-color`, `--accent-color`, `--border-color`, …), `ctx.theme` colors, or hardcoded hex/rgb.
- Never call `ctx.openModal` or `ctx.openConfirm` from inside a `renderModal`: DatoCMS renders the nested dialog *behind* the current modal and the await never resolves (the UI hangs on "Working…"). Instead, have the modal `ctx.resolve(...)` its result, then open any confirm/follow-up modal from the top-level handler (`executeItemsDropdownAction`, `renderPage`, …).
- Render locale/model chips through the shared `chipOption` renderer (single source of truth in `src/components/BulkTranslations/chipOption.tsx`). Pass `classNamePrefix={CHIP_SELECT_CLASS_PREFIX}` to chip `SelectField`s so single- and multi-selects render matching chips.

## Translation Workflow Notes
- Supported providers are currently OpenAI, Gemini, Anthropic, and DeepL.
- There are three main flows: field-level translation, whole-record translation, and bulk translation. Changes that affect one flow often also need review in the shared translation utilities.
- Prompt placeholders and locale handling are shared behavior; treat them as cross-cutting concerns, not one-off UI details.
- If you touch provider errors, batching, locale mapping, or translation routing, review the corresponding tests before finishing.

## Testing Guidelines
- Use `npm run build` as the baseline validation step.
- Add or update Vitest coverage when changing translation logic, provider selection, locale behavior, or error normalization.
- Prefer targeted unit coverage around `src/utils/translation/` over manual-only verification for core translation behavior.
