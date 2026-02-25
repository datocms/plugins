# Repository Guidelines

## Project Structure & Module Organization
This repository is a Vite + React + TypeScript DatoCMS plugin.

- `src/main.tsx`: plugin bootstrap and action registration (`connect`).
- `src/entrypoints/`: UI entrypoints (`SelectCreatorModal.tsx`, `ConfigScreen.tsx`) plus CSS modules.
- `src/actions/`: business logic (bulk creator reassignment).
- `src/services/`: API client setup (`cmaClient.ts`).
- `src/utils/`: shared helpers (React render bridge).
- `public/`: static assets served by Vite.
- `docs/`: screenshots/cover images used for plugin metadata.
- `dist/`: build output (generated; do not edit manually).

## Build, Test, and Development Commands
- `npm install`: install dependencies.
- `npm run dev`: start local dev server (default `http://localhost:5173`).
- `npm run build`: run TypeScript project build (`tsc -b`) and Vite production build.
- `npm run preview`: preview the production bundle locally.
- `npm run prepublishOnly`: runs build before publishing.

Use `npm run build` as the baseline validation step before opening a PR.

## Coding Style & Naming Conventions
- Language: TypeScript with `strict` mode enabled (see `tsconfig.app.json`).
- Follow existing file style: tabs for indentation, semicolons, and double quotes.
- React components: `PascalCase` filenames and exports (for example, `SelectCreatorModal.tsx`).
- Functions/variables: `camelCase`; constants: `UPPER_SNAKE_CASE`.
- Keep UI styles in `*.module.css` next to their entrypoints when possible.

No dedicated ESLint/Prettier config is currently committed, so match nearby code closely.

## Testing Guidelines
There is no automated test suite in this plugin yet. For each change:
- Run `npm run build` to catch type and bundling regressions.
- Manually verify in a DatoCMS project: action appears in item dropdown; modal loads collaborators; success and failure notices behave correctly.

If you add tests, prefer co-locating them with source files and use `*.test.ts`/`*.test.tsx`.

## Commit & Pull Request Guidelines
Recent history favors short, imperative commit subjects (for example, `fix replies`, `refactor ...`, `chore: ...`).

- Keep commit messages focused on one change.
- Prefer `type: short description` (`fix:`, `refactor:`, `chore:`) when applicable.
- PRs should include a clear summary of behavior changes, linked issue/ticket (if available), UI screenshots/GIFs for modal or dropdown changes, and manual test notes describing what was verified in DatoCMS.
