import { isValidIconName } from '../../icons';
import type { TEXTS } from '../../texts';
import type { Parameters, RawFrontend, RawViewport } from '../../types';

type CustomHeader = NonNullable<RawFrontend['customHeaders']>[number];

/**
 * The error of a cell of a TableList or a KeyValueList: the key of its text
 * in TEXTS, never the text itself. The list builds the id of the message
 * from the error, and a text with spaces would make an id that
 * aria-describedby can't point to (it takes a list of ids, split on the
 * spaces), thus the cell would lose its error for a screen reader.
 */
export type CellError = {
  id: Extract<keyof typeof TEXTS, `webPreviews.errors.${string}`>;
};

/** The errors of a custom header, keyed by the columns of its KeyValueList */
export type HeaderErrors = { key?: CellError; value?: CellError };

/**
 * The switches of the features of a frontend. They keep their own state: a
 * URL that the user clears doesn't turn its feature off.
 */
export type FeatureSwitches = { previewLinks: boolean; visualEditing: boolean };

export type FrontendErrors = {
  name?: string;
  /** No feature is on, and the frontend is not disabled */
  feature?: string;
  previewWebhook?: string;
  customHeaders?: HeaderErrors[];
  draftModeUrl?: string;
};

export type ViewportErrors = {
  name?: CellError;
  width?: CellError;
  height?: CellError;
  icon?: CellError;
};

export type SettingsErrors = {
  frontends: FrontendErrors[];
  defaultSidebarWidth?: string;
  viewports: ViewportErrors[];
};

const ENTER_URL = 'Enter a URL that starts with http:// or https://';

function isValidUrl(string: string) {
  let url: URL;
  try {
    url = new URL(string);
  } catch (_) {
    return false;
  }
  return url.protocol === 'http:' || url.protocol === 'https:';
}

export function hasErrors(errors: object): boolean {
  return Object.values(errors).some((error) =>
    Array.isArray(error) ? error.some(hasErrors) : Boolean(error),
  );
}

function validateCustomHeaders(headers: CustomHeader[]): HeaderErrors[] {
  return headers.map((header) => {
    const headerErrors: HeaderErrors = {};

    if (!header.name) {
      headerErrors.key = { id: 'webPreviews.errors.enterHeaderName' };
    } else if (headers.filter((h) => h.name === header.name).length > 1) {
      headerErrors.key = { id: 'webPreviews.errors.repeatedHeaderName' };
    }

    if (!header.value) {
      headerErrors.value = { id: 'webPreviews.errors.enterValue' };
    }

    return headerErrors;
  });
}

export function validateFrontend(
  frontend: RawFrontend,
  allFrontends: RawFrontend[],
  switches: FeatureSwitches,
): FrontendErrors {
  const errors: FrontendErrors = {};

  if (!frontend.name) {
    errors.name = 'Enter a name';
  } else if (
    allFrontends.filter((other) => other.name === frontend.name).length > 1
  ) {
    errors.name = 'Use a name that no other frontend has';
  }

  if (!switches.previewLinks && !switches.visualEditing && !frontend.disabled) {
    errors.feature =
      'Enable Preview Links or Visual Editing, or hide this frontend.';
  }

  // A feature that is on needs its URL: an empty one is no valid URL either
  if (switches.previewLinks) {
    if (!isValidUrl(frontend.previewWebhook ?? '')) {
      errors.previewWebhook = ENTER_URL;
    }

    // The headers show only while preview links are on: hidden headers would
    // block the save with nothing to fix in sight
    const headerErrors = validateCustomHeaders(frontend.customHeaders ?? []);
    if (headerErrors.some(hasErrors)) {
      errors.customHeaders = headerErrors;
    }
  }

  if (
    switches.visualEditing &&
    !isValidUrl(frontend.visualEditing?.enableDraftModeUrl ?? '')
  ) {
    errors.draftModeUrl = ENTER_URL;
  }

  return errors;
}

export function validateViewport(viewport: RawViewport): ViewportErrors {
  const errors: ViewportErrors = {};

  if (!viewport.name) {
    errors.name = { id: 'webPreviews.errors.enterName' };
  }

  if (!viewport.width) {
    errors.width = { id: 'webPreviews.errors.enterWidth' };
  }

  if (!viewport.height) {
    errors.height = { id: 'webPreviews.errors.enterHeight' };
  }

  if (!viewport.icon) {
    errors.icon = { id: 'webPreviews.errors.chooseIcon' };
  } else if (!isValidIconName(viewport.icon)) {
    errors.icon = { id: 'webPreviews.errors.chooseListedIcon' };
  }

  return errors;
}

/** `switches` holds the switches of each frontend, in the same order */
export function validateSettings(
  draft: Parameters,
  switches: FeatureSwitches[],
): SettingsErrors {
  const frontends = draft.frontends ?? [];
  const width = draft.defaultSidebarWidth;

  return {
    frontends: frontends.map((frontend, index) =>
      validateFrontend(frontend, frontends, switches[index]),
    ),
    // The old input was a number input: only digits make a width in pixels
    defaultSidebarWidth:
      !draft.previewLinksSidebarDisabled && width && !/^\d+$/.test(width)
        ? 'Enter a width in pixels'
        : undefined,
    viewports: (draft.defaultViewports ?? []).map(validateViewport),
  };
}
