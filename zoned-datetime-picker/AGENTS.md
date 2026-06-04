# Repository Guidelines

## Project Structure & Module Organization
- `src/main.tsx` is the plugin entry. A single `connect()` registers the `zonedDateTimePicker` editor extension for `json` fields (`renderFieldExtension`) plus a `Show JSON value` field dropdown action that opens the debug modal (`renderModal`).
- `src/components/` holds the React UI:
  - `ZonedDateTimePicker.tsx` parses the stored value once on mount and routes to the editor or, on unreadable data, the read-only `FieldParseError`.
  - `ZonedDateTimeEditor.tsx` is the interactive MUI editor (date-time picker + timezone autocomplete).
  - `DebugModal.tsx` / `FieldParseError.tsx` are `<Canvas>`-wrapped helper screens.
- `src/ui/` is presentation glue: `theme.ts` (DatoCMS → MUI theme mapping), `timePicker.ts` (clock view renderers), `timeZoneAutocomplete.tsx` (option renderer + search filter).
- `src/utils/` holds framework-agnostic logic: `datetime.ts` (`buildDatoOutput`, `parseStoredFieldValue`, zone/offset helpers), `timezones.ts`, `zoneOptions.ts`, `flags.ts`, `search.ts`, and `render.tsx` (the React root).
- `src/i18n/` holds localization: `uiLabels.ts` (`getUiLabels`, English fallback), `parseZones.ts`, and the IANA `zone.tab` data.
- `docs/` stores marketing assets; `public/` holds static files; `dist/` is the build output and is gitignored.

## Build, Test, and Development Commands
- `npm install` installs dependencies.
- `npm run dev` starts the Vite dev server.
- `npm run build` runs `tsc -b && vite build` and produces `dist/` — this is the default validation step.
- `npm run preview` serves the production build.
- `npx tsc -b` performs a standalone type check.
- This package defines no lint or test scripts; the root `biome.json` is the formatting/lint baseline.

## Coding Style & Naming Conventions
- TypeScript + ESNext, React 19, function components, `const`/arrow functions, async/await.
- TSDoc on every exported function; inline comments only for non-obvious logic.
- Two-space indentation, single quotes. React-style booleans (`isFoo`, `hasBar`); descriptive, terse names.
- Prefer `datocms-react-ui` and small local components; reach for raw MUI only for the picker/autocomplete interactions it already owns.

## Theming & Dark Mode
This plugin renders its own MUI surface, so `<Canvas>` alone is not enough for dark mode — the MUI palette must be driven explicitly.
- `createMuiThemeFromDato` (`src/ui/theme.ts`) sets `palette.mode` from `ctx.colorScheme` and maps `ctx.cssDesignTokens` (the host's semantic `--color--*` tokens, pre-resolved for the active scheme) into the palette.
- Feed **concrete** token values, not `var(--color--*)` strings: MUI's `cssVariables` hoists palette values onto `:root`, where the Canvas-scoped Dato tokens would not resolve.
- Keep `cssVariables: { nativeColor: true }` (token values are `oklch()`, so MUI must manipulate them via CSS `color-mix()` rather than JS color parsing) and provide explicit `contrastText`/`light`/`dark` so MUI never tries to parse `oklch()` at theme-creation time.
- The theme is rebuilt in a `useMemo` keyed on `[colorScheme, cssDesignTokens, theme]`; these `ctx` slices are stable between host updates, so it only rebuilds on a real change.
- `ctx.theme` is deprecated (light-only) and used solely as a fallback for hosts that predate the token system.
- `index.html` carries an inline `color-scheme: light dark` + transparent root to avoid a white first-paint flash before the SDK's async handshake applies the host scheme.

## Behavior & Data Notes
- The field stores a JSON **string**; `buildDatoOutput` derives every output field (IXDTF, ISO 8601, zone, offset, epoch, …). Only user-driven handlers call `setFieldValue` — never on mount — to avoid marking the form dirty or overwriting an unparseable value.
- The editor keeps local wall-clock time (no offset) in state; Luxon re-derives the offset on save so DST is preserved.
- Both poppers use `disablePortal` so they stay inside the iframe; height is managed manually via `startAutoResizer`/`stopAutoResizer`/`setHeight` around open/close.

## Commit & Release Guidelines
- Commit subjects are short and action-focused (history uses an optional `Zoned DateTime Picker:` prefix, ≈72 chars).
- To release: bump `version` in `package.json` (and the two refs in `package-lock.json`), prepend a `## Changelog` entry in `README.md`, and run `npm run build`. `dist/` is gitignored, so no build artifacts are committed.
