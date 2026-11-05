import { useEffect } from 'react';
import type { FrontendStatus } from './common';

export type StatusByFrontend = Record<string, FrontendStatus | undefined>;

/**
 * One line of the code box of an error state: the raw message of the error
 * of a frontend. The request names the frontend and the plugin in its
 * message, for the console: the line drops them, and starts with the name of
 * the frontend only when there are several frontends.
 */
export function failureLine({
  frontend,
  error,
  named,
}: {
  frontend: string;
  error: unknown;
  /** Several frontends: the line starts with the name of this one */
  named: boolean;
}): string {
  const raw = error instanceof Error ? error.message : String(error);
  const lead = `[Web Previews] API endpoint for frontend "${frontend}" `;
  const message = raw.startsWith(lead)
    ? `The endpoint ${raw.slice(lead.length).replace(/!$/, '')}`
    : raw;

  return named ? `${frontend}: ${message}` : message;
}

/**
 * What to do when the preview links of frontends didn't load, up to the
 * words that name the plugin settings
 */
export const FAILED_LINKS_NEXT_STEP_LEAD =
  'Reload the page to try again. If it keeps failing, ask a developer to check the';

/** The words of the next step that name the plugin settings */
export const PLUGIN_SETTINGS_WORDS = 'plugin settings';

/**
 * What to do when the preview links of frontends didn't load: the
 * description of the error states, for the editor and for a developer
 */
export const FAILED_LINKS_NEXT_STEP = `${FAILED_LINKS_NEXT_STEP_LEAD} ${PLUGIN_SETTINGS_WORDS}.`;

/** The details of a failed request go to the browser console, for developers */
export function useLogFailures(statusByFrontend: StatusByFrontend | undefined) {
  useEffect(() => {
    if (!statusByFrontend) {
      return;
    }

    for (const [frontend, status] of Object.entries(statusByFrontend)) {
      if (status && 'error' in status) {
        console.error(
          `[Web Previews] The preview links of the frontend "${frontend}" didn't load:`,
          status.error,
        );
      }
    }
  }, [statusByFrontend]);
}
