import type { Components, Theme as MuiTheme } from '@mui/material/styles';
import { createTheme } from '@mui/material/styles';
import type { CssDesignTokens, Theme as DatoTheme } from 'datocms-plugin-sdk';

/**
 * Inputs needed to mirror the host's current appearance into an MUI theme.
 *
 * @property colorScheme - Resolved host color scheme (`'system'` already
 *   expanded by the SDK). Drives `palette.mode`.
 * @property tokens - `ctx.cssDesignTokens`: semantic CSS custom property names
 *   (e.g. `--color--ink`) mapped to their resolved value for the active scheme.
 * @property theme - `ctx.theme`: the deprecated, light-only color set, used only
 *   as a fallback on hosts that predate the token system.
 */
export type DatoThemeInput = {
  colorScheme: 'light' | 'dark';
  tokens: CssDesignTokens;
  theme: DatoTheme;
};

/**
 * Autocomplete option styling, shared across both theme branches.
 *
 * Non-cosmetic rationale: ensure selected and hover states use the host's
 * semantic interaction tokens with high contrast inside the constrained iframe,
 * and remove the default focus fill which clashes with our selected-state
 * background. Colors are pulled from the palette so they follow whichever
 * values the active branch resolved (token-driven in dark mode, legacy in
 * pre-token hosts).
 */
const autocompleteOverrides: Components<MuiTheme> = {
  MuiAutocomplete: {
    styleOverrides: {
      option: ({ theme }) => ({
        '&.Mui-focused': {
          backgroundColor: 'unset !important',
        },
        '&:hover': {
          backgroundColor: `${theme.palette.secondary.light} !important`,
          '*': {
            color: `${theme.palette.secondary.dark} !important`,
          },
        },
        '&[aria-selected="true"]': {
          backgroundColor: `${theme.palette.primary.main} !important`,
          color: `${theme.palette.primary.contrastText} !important`,
          '*': {
            color: `${theme.palette.primary.contrastText} !important`,
          },
        },
      }),
    },
  },
};

/**
 * Build an MUI theme that tracks DatoCMS dark/light mode.
 *
 * The host pre-resolves every semantic color for the active scheme and exposes
 * them as `ctx.cssDesignTokens`. We feed those concrete values straight into the
 * MUI palette (rather than `var(--color--*)` references) because MUI's
 * `cssVariables` feature hoists palette values onto `:root`, where the
 * Canvas-scoped Dato tokens would not resolve. Concrete values sidestep that and
 * stay correct after every host theme change, as long as the theme is rebuilt
 * when `colorScheme`/`tokens` change.
 *
 * `cssVariables.nativeColor` is required: token values are `oklch(…)`, and MUI's
 * internal `alpha()`/`lighten()` calls (e.g. Autocomplete option states) must run
 * as CSS `color-mix()` rather than JS color parsing, which cannot decompose
 * `oklch()`. Explicit `contrastText`/`light`/`dark` likewise keep MUI from trying
 * to compute them in JS at theme-creation time.
 *
 * Hosts without the token system fall back to the original light-only mapping
 * derived from the deprecated `ctx.theme`, preserving prior behavior verbatim.
 *
 * @param input - Resolved color scheme, semantic tokens, and legacy fallback.
 * @returns Configured MUI theme.
 * @example
 * ```ts
 * const muiTheme = createMuiThemeFromDato({
 *   colorScheme: ctx.colorScheme,
 *   tokens: ctx.cssDesignTokens,
 *   theme: ctx.theme,
 * });
 * ```
 */
export function createMuiThemeFromDato({
  colorScheme,
  tokens,
  theme,
}: DatoThemeInput) {
  // Pre-token hosts: no semantic tokens, no dark mode — reproduce the original
  // light-only palette so nothing regresses on older DatoCMS deployments.
  if (!tokens['--color--surface']) {
    return createTheme({
      cssVariables: { nativeColor: true },
      palette: {
        primary: { main: theme.primaryColor },
        secondary: {
          main: theme.accentColor,
          light: theme.lightColor,
          dark: theme.darkColor,
        },
      },
      components: autocompleteOverrides,
    });
  }

  /** Resolve a semantic token, falling back when the host omits it. */
  const token = (name: string, fallback: string): string =>
    tokens[name] || fallback;

  return createTheme({
    cssVariables: { nativeColor: true },
    palette: {
      mode: colorScheme,
      primary: {
        main: token('--color--selected--surface', theme.primaryColor),
        contrastText: token('--color--selected--ink', '#fff'),
        light: token('--color--selected--surface-hover', theme.lightColor),
        dark: token('--color--selected--border', theme.darkColor),
      },
      secondary: {
        // Option hover background/text; selected state uses `primary` above.
        main: token('--color--ink-link', theme.accentColor),
        light: token('--color--surface-hover', theme.lightColor),
        dark: token('--color--ink', theme.darkColor),
        contrastText: token('--color--ink', '#fff'),
      },
      text: {
        primary: token('--color--ink', 'rgba(0, 0, 0, 0.87)'),
        secondary: token('--color--ink-subtle', 'rgba(0, 0, 0, 0.6)'),
        disabled: token('--color--ink-placeholder', 'rgba(0, 0, 0, 0.38)'),
      },
      background: {
        default: token('--color--surface', '#fff'),
        // Popovers/menus (the picker popup, the zone listbox) are raised
        // surfaces; fall back to the flat surface, then white.
        paper:
          tokens['--color--surface-raised'] ||
          tokens['--color--surface'] ||
          '#fff',
      },
      divider: token('--color--border', 'rgba(0, 0, 0, 0.12)'),
      error: {
        main: token('--color--danger-soft--ink', '#d32f2f'),
        light: token('--color--danger-soft--surface', '#ef5350'),
        dark: token('--color--danger-soft--ink', '#c62828'),
        contrastText: token('--color--ink', '#fff'),
      },
    },
    components: autocompleteOverrides,
  });
}
