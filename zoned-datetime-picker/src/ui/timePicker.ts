import { renderTimeViewClock } from "@mui/x-date-pickers/timeViewRenderers";

/**
 * Use the clock UI for all time views to provide a consistent, compact
 * experience inside the Dato iframe regardless of platform defaults.
 */
export const CLOCK_VIEW_RENDERERS = {
  hours: renderTimeViewClock,
  minutes: renderTimeViewClock,
  seconds: renderTimeViewClock,
} as const;
