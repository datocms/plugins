import type { ConfirmOptions, RenderPageCtx, Toast } from 'datocms-plugin-sdk';
import { CMA_BASE_URL } from './fakeCma/http';
import type { Scenario } from './fakeCma/scenarios';
import { SITE_ID, SITE_LOCALES } from './fakeCma/schema';

/**
 * The mock `RenderPageCtx` for the preview frame (a full-size page: no
 * auto-resizer functions, `bodyPadding` 0). Overlays go to the harness host:
 * toasts to its toast strip; confirms are answered by `?confirm=yes|no`, or
 * shown in the host's confirm dialog (`window.confirm` when the frame is
 * opened on its own).
 */

declare global {
  interface Window {
    /** Defined by harness.html: shows a host toast, resolves the CTA value or null. */
    __harnessToast?: (toast: Toast) => Promise<unknown>;
    /** Defined by harness.html: a host-drawn confirm, resolves the chosen value. */
    __harnessConfirm?: (options: ConfirmOptions) => Promise<unknown>;
    /** Defined by the frame: re-renders the page with a fresh ctx object (same primitives). */
    __harnessNewCtx?: () => void;
  }
}

export type ColorScheme = 'light' | 'dark';

/** `?confirm=yes|no` answers every `openConfirm`; null asks the reviewer. */
export type ConfirmAnswer = 'yes' | 'no' | null;

export function readConfirmAnswer(value: string | null): ConfirmAnswer {
  return value === 'yes' || value === 'no' ? value : null;
}

export const PAGE_ID = 'find-and-replace';
export const HARNESS_TOKEN = 'harness-token';

function hostWindow(): Window {
  return window.parent === window ? window : window.parent;
}

function showHostToast(toast: Toast): Promise<unknown> {
  const show = hostWindow().__harnessToast;
  if (!show) {
    console.info('[ctx] toast', toast);
    return Promise.resolve(null);
  }
  return show(toast);
}

async function askConfirm(
  options: ConfirmOptions,
  answer: ConfirmAnswer,
): Promise<unknown> {
  console.info('[ctx] openConfirm', options);
  if (answer !== null) {
    return answer === 'yes'
      ? (options.choices[0]?.value ?? null)
      : options.cancel.value;
  }
  const hostConfirm = hostWindow().__harnessConfirm;
  if (hostConfirm) return hostConfirm(options);
  return window.confirm(`${options.title}\n\n${options.content}`)
    ? (options.choices[0]?.value ?? null)
    : options.cancel.value;
}

function buildRole(canEdit: boolean) {
  return {
    type: 'role',
    id: 'harness-role',
    attributes: { name: canEdit ? 'Editor' : 'No access' },
    meta: {
      final_permissions: {
        can_edit_schema: false,
        positive_item_type_permissions: canEdit
          ? [
              {
                environment: 'main',
                action: 'all',
                item_type: null,
                workflow: null,
              },
            ]
          : [],
        negative_item_type_permissions: [],
      },
    },
  };
}

const ACCOUNT = {
  type: 'account',
  id: 'harness-account',
  attributes: {
    email: 'editor@acme.test',
    first_name: 'Harness',
    last_name: 'Editor',
    company: 'Acme',
  },
};

export function buildCtx(args: {
  scenario: Scenario;
  scheme: ColorScheme;
  cssDesignTokens: Record<string, string>;
  confirm: ConfirmAnswer;
}): RenderPageCtx {
  const log = async (...values: unknown[]) => {
    console.info('[ctx]', ...values);
  };

  const ctx = {
    mode: 'renderPage',
    pageId: PAGE_ID,
    location: {
      pathname: `/p/harness/pages/${PAGE_ID}`,
      search: '',
      hash: '',
    },
    bodyPadding: [0, 0, 0, 0],
    cssDesignTokens: args.cssDesignTokens,
    colorScheme: args.scheme,
    theme: {},
    ui: { locale: 'en' },
    plugin: {
      type: 'plugin',
      id: 'harness',
      attributes: { name: 'Find and Replace', parameters: {} },
    },
    currentRole: buildRole(args.scenario.roleCanEdit),
    currentUser: ACCOUNT,
    owner: ACCOUNT,
    account: ACCOUNT,
    currentUserAccessToken: args.scenario.token ? HARNESS_TOKEN : undefined,
    cmaBaseUrl: CMA_BASE_URL,
    cdaEndpointUrl: 'https://graphql.datocms.com/',
    environment: 'main',
    isEnvironmentPrimary: true,
    site: {
      type: 'site',
      id: SITE_ID,
      attributes: {
        name: 'Acme',
        internal_domain: 'harness.admin.datocms.com',
        locales: [...SITE_LOCALES],
      },
    },
    itemTypes: {},
    fields: {},
    users: {},
    ssoUsers: {},
    notice: async (message: string) => {
      await showHostToast({ type: 'notice', message });
    },
    alert: async (message: string) => {
      await showHostToast({ type: 'alert', message });
    },
    customToast: (toast: Toast) => showHostToast(toast),
    openConfirm: (options: ConfirmOptions) => askConfirm(options, args.confirm),
    navigateTo: log,
  };

  return ctx as unknown as RenderPageCtx;
}
