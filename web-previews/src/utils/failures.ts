import { useEffect } from 'react';
import type { FrontendStatus } from './common';

export type StatusByFrontend = Record<string, FrontendStatus | undefined>;

/** The raw message of an error, for the code box of an error state */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The start of the next step when the preview links of frontends didn't
 * load, up to the words that name the plugin settings
 */
export function failedLinksNextStepLead(failedFrontends: number): string {
  return failedFrontends === 1
    ? 'Reload the record, or ask a developer to check the preview links endpoint in the'
    : 'Reload the record, or ask a developer to check the preview links endpoints in the';
}

/** The words of the next step that name the plugin settings */
export const PLUGIN_SETTINGS_WORDS = 'plugin settings';

/**
 * What to do when the preview links of frontends didn't load: the
 * description of the error states, for the editor and for a developer
 */
export function failedLinksNextStep(failedFrontends: number): string {
  return `${failedLinksNextStepLead(failedFrontends)} ${PLUGIN_SETTINGS_WORDS}.`;
}

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
