import { createTheme } from "@mui/material/styles";

/**
 * Map DatoCMS theme colors into an MUI theme and apply component overrides.
 *
 * Non-cosmetic rationale
 * - `MuiAutocomplete.styleOverrides.option`: ensure selected and hover states
 *   match user's selected colors and keep contrast high for readability inside the
 *   constrained iframe. Also remove the default focus fill which clashes with
 *   our selected state background.
 *
 * @param primaryColor - Brand primary color (used for selected state)
 * @param accentColor - Secondary main color
 * @param lightColor - Secondary light shade (hover background)
 * @param darkColor - Secondary dark shade (hover text)
 * @returns Configured MUI theme
 * @example
 * ```ts
 * const theme = createMuiThemeFromDato('#ff0000', '#00aaee', '#e0f7ff', '#004c66');
 * ```
 */
export function createMuiThemeFromDato(
  primaryColor: string,
  accentColor: string,
  lightColor: string,
  darkColor: string
) {
  return createTheme({
    palette: {
      primary: { main: primaryColor },
      secondary: { main: accentColor, light: lightColor, dark: darkColor },
    },
    components: {
      MuiAutocomplete: {
        styleOverrides: {
          option: ({ theme }) => ({
            "&.Mui-focused": {
              backgroundColor: "unset !important",
            },
            "&:hover": {
              backgroundColor: `${theme.palette.secondary.light} !important`,
              "*": {
                color: `${theme.palette.secondary.dark} !important`,
              },
            },
            '&[aria-selected="true"]': {
              backgroundColor: `${theme.palette.primary.main} !important`,
              color: `${theme.palette.primary.contrastText} !important`,
              "*": {
                color: `${theme.palette.primary.contrastText} !important`,
              },
            },
          }),
        },
      },
    },
  });
}
