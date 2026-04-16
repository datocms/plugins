# Repository Guidelines

## Project Structure & Module Organization
This package is a Vite + React + TypeScript DatoCMS plugin for copying localized content between locales.

- `src/main.tsx`: registers the config screen, settings page, and `localeCopyButton` field addon.
- `src/entrypoints/ConfigScreen.tsx`: stores which fields should expose the field-level copy action.
- `src/entrypoints/SettingsAreaSidebar.tsx`: owns the bulk locale-duplication workflow and progress reporting.
- `src/entrypoints/FieldExtension.tsx`: renders the per-field copy UI in the record editor.
- `src/services/`: CMA access and duplication logic.
- `src/components/`: configuration, progress, summary, and error-boundary UI.
- `dist/`: generated plugin bundle; do not edit manually.

## Build, Test, and Development Commands
Run from `locale-duplicate/`:
- `npm run dev`
- `npm run build`
- `npm run preview`

This package does not currently define package-local lint or test scripts.

## Coding Style & Naming Conventions
- Follow the repo-wide Biome conventions and the existing local style in the files you touch.
- Prefer `datocms-react-ui` components and the current component structure for UI work.
- Keep CMA interaction inside the service or orchestration layer instead of spreading it across presentational components.
- Store field-copy configuration through plugin parameters; do not introduce local persistence for core behavior.

## Product Notes
- Bulk duplication intentionally overwrites the target locale with values from the source locale unless the task explicitly changes that behavior.
- The package has two distinct surfaces: bulk duplication in Settings and field-level copying in the record editor. Changes to shared locale or field handling should be checked against both.
- The plugin depends on `currentUserAccessToken` for CMA access through the DatoCMS context.

## Validation
- `npm run build` is required after edits.
- If you change duplication logic or field handling, manually verify both the settings workflow and the field-level copy flow in DatoCMS.
- If you want linting for touched files, use the repo root Biome configuration rather than inventing package-local commands.
