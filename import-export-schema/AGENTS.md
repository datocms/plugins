# Repository Guidelines

## Project Structure & Module Organization
- `src/entrypoints/` hosts the Config, Export, and Import plugin pages plus local helpers; `index.tsx` wires each page to DatoCMS.
- `src/components/` gathers shared React pieces such as overlays, selectors, and graph controls.
- `src/utils/` contains schema builders, progress types, download helpers, and graph utilities; extend existing modules before adding new single-use files.
- `public/` and `index.html` power the Vite shell; the production entry lives at `dist/index.html`. Keep `dist/` build-only.
- `docs/` stores marketplace assets and baseline QA notes (`docs/refactor-baseline.md`).

## Build, Test, and Development Commands
- `npm run build`

## Coding Style & Naming Conventions
- Language stack: TypeScript + React 18 with Vite.
- Follow Biome defaults (2-space indent, single quotes, sorted imports). Run `npm run format` prior to commits.
- Use PascalCase for components (`ExportStartPanel.tsx`), camelCase for functions/variables, and PascalCase for types/interfaces.
- Prefer CSS modules; reference class names via `styles.<name>` and reuse design tokens from `datocms-react-ui`.

## Security & Configuration Tips
- Never log or hardcode tokens; rely on `@datocms/cma-client` injected credentials.
- Avoid mutating existing schema objects in place; prefer additive or cloned changes to prevent data loss.
- Inspect diffs for accidental secrets or large asset files before pushing.

## Active Engineering Tasks (September 17, 2025)
- [x] Deduplicate export task handling by introducing a shared helper/hook that wraps `buildExportDoc` and `useLongTask`.
- [x] Centralize long-task overlay composition so entrypoints declare overlays declaratively instead of repeating JSX.
- [x] Break down `src/entrypoints/ExportPage/Inner.tsx` into smaller modules and move dependency-closure logic to a shared utility.
- [x] Improve `useExportSelection` to reuse cached item types instead of per-id fetch loops.
- [x] Tackle remaining polish items (debug logging helper, shared graph threshold config, styling cleanup) to keep the codebase DRY.
