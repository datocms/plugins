import type { Modal } from 'datocms-plugin-sdk';

/**
 * The same-origin bridge between the host page (index.html) and its plugin
 * frames (frame.html). The host defines `window.__harnessHost`; frames call
 * it through `window.parent`. Values that cross the bridge are cloned on the
 * receiving side (see `cloneIntoThisRealm`) so plugin code never holds objects
 * from another frame's realm.
 */

export type HostToastType = 'notice' | 'alert' | 'warning' | 'log';

export type HostToast = {
  type: HostToastType;
  message: string;
  cta?: { label: string; value: unknown };
  /**
   * As in `ctx.customToast`: `true` closes it after 6s, a number after that
   * many ms; `false` or omitted keeps it until closed (see `toastTimeout`).
   */
  dismissAfterTimeout?: boolean | number;
};

/** The dashboard's toast timeout: `ctx.notice` and `dismissAfterTimeout: true`. */
export const TOAST_TIMEOUT_MS = 6000;
/** The harness's own `log` toasts (mocked no-op calls) close after 4s. */
export const LOG_TOAST_TIMEOUT_MS = 4000;

/**
 * When a toast closes on its own, in ms, or null when it stays until closed.
 * The dashboard settles the toast's promise only when it closes, so a plugin
 * that awaits `ctx.notice()` waits the full 6s; the harness keeps that.
 */
export function toastTimeout(toast: HostToast): number | null {
  const { dismissAfterTimeout } = toast;
  if (typeof dismissAfterTimeout === 'number') {
    return dismissAfterTimeout;
  }
  if (dismissAfterTimeout === true) {
    return TOAST_TIMEOUT_MS;
  }
  if (dismissAfterTimeout === undefined && toast.type === 'log') {
    return LOG_TOAST_TIMEOUT_MS;
  }
  return null;
}

export type ModalSession = {
  modal: Modal;
  /** The opener's plugin parameters at the time of the call. */
  pluginParameters: Record<string, unknown>;
  uiLocale: string;
};

export type ModalRequest = ModalSession & {
  /** Called once with the value passed to `ctx.resolve`, or null on ✕/Esc. */
  onResolve: (value: unknown) => void;
};

export type InspectorEntry = { label: string; value: unknown };

export type HarnessHostApi = {
  /** Shows a toast; resolves with the CTA value, or null when dismissed. */
  toast: (toast: HostToast) => Promise<unknown>;
  /** Opens a modal frame over a backdrop. */
  openModal: (request: ModalRequest) => void;
  /** What a modal frame reads on boot (`frame.html?modalSession=`). */
  modalSession: (sessionId: string) => ModalSession | null;
  /** `ctx.resolve` in a modal frame: closes it and settles the opener. */
  resolveModal: (sessionId: string, value: unknown) => void;
  /** Esc inside a modal frame: closes it like ✕ unless `closeDisabled`. */
  dismissModal: (sessionId: string) => void;
  /** The main frame's mock state, shown under the stage. */
  inspect: (entries: InspectorEntry[]) => void;
  /** Field config errors: the host draws the box with a red border. */
  setInvalid: (invalid: boolean) => void;
};

declare global {
  interface Window {
    __harnessHost?: HarnessHostApi;
  }
}

/** The host API, or null when frame.html is opened on its own. */
export function getHost(): HarnessHostApi | null {
  if (window.parent === window) {
    return null;
  }
  try {
    return window.parent.__harnessHost ?? null;
  } catch {
    return null;
  }
}

/**
 * Deep-copies plain data into the calling frame's realm, so `instanceof`,
 * prototypes and `Array.isArray` behave as if the host had posted it.
 */
export function cloneIntoThisRealm<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch (error) {
    console.warn('[harness] Could not clone a value across frames.', error);
    return value;
  }
}
