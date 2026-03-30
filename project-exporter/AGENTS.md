# Repository Guidelines

## Project Structure & Module Organization
This plugin is a React + TypeScript DatoCMS app. Keep code changes inside `src/` unless updating docs or static assets.
- `src/index.tsx`: plugin bootstrap and SDK wiring.
- `src/entrypoints/`: UI entrypoints (`ConfigScreen`, sidebar panel, loading overlay) and CSS modules.
- `src/utils/`: export logic for records/assets and file-format builders.
- `public/`: static HTML shell used by `react-scripts`.
- `docs/`: plugin preview media (`cover.png`, `preview.mp4`).

Generated output goes to `build/` after a production build and should not be edited manually.

## Build, Test, and Development Commands
- `npm install`: install dependencies.
- `npm start`: start local development server (`react-scripts start` with `BROWSER=none`).
- `npm run build`: create production bundle in `build/`.
- `npm test`: run Jest in watch mode through `react-scripts test`.
- `npm run prepublishOnly`: build check executed before publishing.

## Coding Style & Naming Conventions
- Use TypeScript with strict mode expectations from `tsconfig.json`.
- Prefer 2-space indentation, semicolons, and clear import grouping.
- Components and types use PascalCase (`ConfigScreen`, `AvailableFormats`).
- Functions, variables, and helpers use camelCase (`downloadAllRecords`, `loadingStatus`).
- Keep styles in CSS modules (`*.module.css`) colocated with entrypoint components.
- ESLint is configured via `react-app`; address lint warnings before opening a PR.

## Testing Guidelines
- Test stack is Jest via `react-scripts` (React Testing Library compatible).
- Add tests alongside source files as `*.test.ts` or `*.test.tsx` under `src/`.
- Focus coverage on export filtering, format conversion behavior, and utility edge cases.
- For one-shot runs, use `npm test -- --watchAll=false`.

## Commit & Pull Request Guidelines
- Follow short, imperative commit subjects. Prefixes like `fix:`, `refactor:`, and `chore:` are consistent with existing history.
- Keep each commit focused (example: `fix: handle empty model selection in export flow`).
- PRs should include what changed and why, commands/tests executed, linked issue/task (if available), and a screenshot or short video for UI changes in config/sidebar screens.

## Security & Configuration Tips
- Do not commit tokens, exports, or project-specific secrets.
- Access DatoCMS credentials only through SDK context (`ctx.currentUserAccessToken`).
- For very large exports, mention browser limits and prefer official DatoCMS export tooling when needed.
