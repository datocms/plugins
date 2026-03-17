# Repository Guidelines

## Agent Orchestration
- Use subagents by default whenever work can be split, explored, implemented, or verified in parallel.
- Spawn as many subagents as are useful for the task, provided each one has a clear, bounded responsibility that materially advances the result.
- Keep the main thread focused on critical-path decisions, integration, and final validation; only avoid delegation when it would add overhead or block progress.

## Project Structure & Module Organization
- `src/` contains the TypeScript/React source. Key entry points live in `src/entrypoints/` (for example `CommentsBar.tsx` and `ConfigScreen.tsx`). Shared helpers live under `src/entrypoints/utils/`, `hooks/`, `contexts/`, and `styles/`.
- `src/main.tsx` wires the DatoCMS plugin lifecycle and registers the record sidebar screen.
- `tests/unit/` holds Vitest unit tests, with fixtures in `tests/unit/fixtures/`.
- `docs/` stores plugin media (e.g., `docs/cover.png`, `docs/demo.mp4`).
- `dist/` is the built plugin output referenced by the plugin manifest; do not edit by hand; rebuild instead.

## Build, Test, and Development Commands
- `npm run dev` starts the Vite dev server for local development.
- `npm run build` runs the TypeScript build (`tsc -b`) and produces the production bundle in `dist/`.
- `npm run preview` serves the built plugin locally for verification.
- `npm run test` or `npm run test:unit` runs Vitest; `npm run test:unit:coverage` generates coverage output.

## Coding Style & Naming Conventions
- Codebase is TypeScript + React (ES modules) and uses 2-space indentation and semicolons.
- Components and entry points use PascalCase filenames (`CommentsBar.tsx`), utilities use camelCase (`useOperationQueue.ts`).
- Path aliases are available in tooling (e.g., `@/`, `@components/`, `@utils/`), so prefer them for internal imports.

## Testing Guidelines
- Framework: Vitest (node environment). Test files are `tests/unit/**/*.test.ts`.
- Keep new tests colocated under the appropriate unit folder (e.g., `tests/unit/utils/`).
- Coverage targets focus on `src/**/*.ts(x)`; exclude generated or entry files like `src/main.tsx`.

## Commit & Pull Request Guidelines
- Recent commits use short, lowercase, descriptive messages (e.g., `layout`, `version bump`, `cleanup`). Follow that style unless a broader convention is introduced.
- PRs should include: a concise summary, testing performed (commands + results), and screenshots or short clips for UI changes. Link related issues if applicable and note any `dist/` rebuilds.

## Configuration Notes
- This is a DatoCMS plugin; ensure plugin settings (CDA token) are documented in the PR if required for new features.
