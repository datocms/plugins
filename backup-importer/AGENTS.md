# Repository Guidelines

## Project Structure & Module Organization
- `src/main.tsx` bootstraps the DatoCMS plugin.
- `src/entrypoints/` contains UI entrypoints (notably `ConfigScreen.tsx`) and `src/entrypoints/components/` holds upload/drop-zone components.
- `src/importer/` contains the import pipeline (validation, rewriting, planning, execution, retries, checkpointing, assets, reporting).
- Tests are colocated with importer modules as `*.test.ts` (for example `src/importer/rewrite.test.ts`).
- `docs/` stores implementation notes and plans; `dist/` is build output; `public/` contains static assets.

## Build, Test, and Development Commands
- `npm run dev`: start Vite dev server for local plugin development.
- `npm run build`: run TypeScript project build (`tsc -b`) and create production bundle in `dist/`.
- `npm run preview`: serve the production build locally.
- `npm test`: run Vitest once (CI-style).
- `npm run test:watch`: run Vitest in watch mode for iterative development.

## Coding Style & Naming Conventions
- Language stack is TypeScript + React (functional components).
- Follow surrounding file style; importer modules currently use 2-space indentation and single quotes.
- Use `PascalCase` for React component files (`ConfigScreen.tsx`), `camelCase` for functions/variables, and descriptive noun-based module names (`schemaMapping.ts`, `assetImport.ts`).
- Keep modules focused by concern; place shared contracts in `src/importer/types.ts`.

## Testing Guidelines
- Framework: Vitest (`vitest run` / `vitest`).
- Add or update tests for every behavior change in `src/importer/`.
- Name tests `*.test.ts` and keep them next to the code under test.
- Prefer deterministic fixtures and mocked CMA interactions; avoid live network calls in unit tests.

## Commit & Pull Request Guidelines
- Recent history uses short, imperative commit subjects; conventional prefixes appear in some commits (for example `chore: ...`, `refactor ...`, `fix ...`).
- Keep commits scoped to one logical change.
- PRs should include: purpose, key implementation notes, test evidence (`npm test` output), and screenshots for UI changes in `src/entrypoints/`.

## Security & Configuration Tips
- The plugin requests `currentUserAccessToken`; never commit tokens or real backup payloads.
- Keep large export ZIP/JSON fixtures out of Git unless intentionally anonymized and minimal.

## Importer Plan Baseline (Counterpart to `project-exporter`)
- Treat `../project-exporter/README.md` as the source export contract (not assumptions). The importer must consume the exporter envelope/schema/reference index exactly.
- Use DatoCMS CMA docs as the implementation authority, starting from `https://www.datocms.com/docs/content-management-api.md` and related endpoint docs before changing importer behavior.
- CMA guardrail: when listing items for reconciliation, pass an explicit `version` (`current` or `published`) instead of relying on project defaults.
- UX baseline: user drops a JSON export file (and optional asset ZIP chunks), runs preflight, then executes import with clear progress and error reporting.
- Use a deterministic multi-pass strategy:
  1. Validate envelope and schema maps before writes.
  2. Bootstrap all records with minimal payloads to build `sourceRecordId -> targetRecordId`.
  3. Import/reconcile assets and build `sourceUploadId -> targetUploadId`.
  4. Patch full content after recursive reference rewriting.
  5. Replay tree relations and publish state.
- Explicitly handle DatoCMS recursive pitfalls: circular links (`A -> B -> A`), nested modular blocks, structured text links/blocks, nested blocks inside structured text, localized fields, and mixed recursion across these structures.
- Reliability requirements: chunked processing for large datasets, retry/backoff for transient CMA failures, checkpoint/resume, dedupe/idempotency where possible, and strict/non-strict failure modes.
- Concurrency pitfall: handle CMA optimistic-locking failures (`STALE_ITEM_VERSION`) with refetch-and-retry logic where safe.
- Test expectations for every importer change: add/update fixtures covering circular refs, deep nesting, unresolved refs, asset mapping, and schema drift scenarios.
- Operational rule for this repository: never commit from agent tasks unless the user explicitly asks for a commit.
