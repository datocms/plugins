type ClickToEditSyncOptions = {
  /** The editor's stored choice, read at call time */
  getPreferred: () => boolean;
  /** Sends a state to the page; may be a no-op while no connection exists */
  apply: (enabled: boolean) => void;
  /** Runs a callback once the current handshake completes */
  defer: (callback: () => void) => void;
};

/**
 * Re-applies the editor's click-to-edit choice to every page the preview
 * loads. Penpal keeps one connection across child reloads and full
 * navigations, so each new page announces itself only through `onInit`.
 */
export function createClickToEditSync({
  getPreferred,
  apply,
  defer,
}: ClickToEditSyncOptions) {
  let isAwaitingFirstState = false;

  return {
    /** A page (re)connected: it starts from its own default */
    onInit: () => {
      isAwaitingFirstState = true;
      // onInit answers the page's handshake call; send after it completes
      defer(() => apply(getPreferred()));
    },
    /**
     * The first report after onInit catches pages that set their own default
     * after the handshake. Later reports (e.g. Alt in the page) are left alone.
     */
    onStateChange: (clickToEditEnabled: boolean) => {
      if (!isAwaitingFirstState) {
        return;
      }

      isAwaitingFirstState = false;
      if (clickToEditEnabled !== getPreferred()) {
        apply(getPreferred());
      }
    },
  };
}
